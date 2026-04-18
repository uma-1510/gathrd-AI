// app/api/photos/upload/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";
import sharp from "sharp";
import * as exifr from "exifr";
import { captionImage, embedText, toSqlVector } from "@/lib/hf";
import { buildDescription } from "@/lib/description";
import { matchFaceToPeople } from "@/lib/faceMatcher";
import { syncLocationAlbum } from "@/lib/locationAlbum";

const VIDEO_MIME_TYPES = new Set([
  "video/mp4", "video/quicktime", "video/x-msvideo",
  "video/webm", "video/x-matroska", "video/mpeg",
]);
const VIDEO_EXTENSIONS = /\.(mp4|mov|avi|webm|mkv|mpeg|mpg)$/i;

function isVideo(file) {
  return VIDEO_MIME_TYPES.has(file.type) || VIDEO_EXTENSIONS.test(file.name);
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { "User-Agent": "gathrd-photo-app/1.0" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address;
    return (
      [a.city || a.town || a.village || a.county, a.state, a.country]
        .filter(Boolean)
        .join(", ") || null
    );
  } catch {
    return null;
  }
}

function buildVideoDescription(filename) {
  const cleanName = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]/g, " ")
    .replace(/\d{13}[-_]?/g, "")
    .trim();
  return `A video clip${cleanName ? `: ${cleanName}` : ""}.`;
}

// ── FIX: robust EXIF date extraction ─────────────────────────────────────────
// exifr returns dates as JS Date objects, and the field name varies by camera.
// Try all known date fields and convert whichever one we find to an ISO string.
function extractExifDate(exif) {
  if (!exif) return null;
  const candidates = [
    exif.DateTimeOriginal,
    exif.CreateDate,
    exif.DateTime,
    exif.ModifyDate,
    exif.GPSDateTime,
  ];
  for (const val of candidates) {
    if (!val) continue;
    // Already a Date object
    if (val instanceof Date && !isNaN(val.getTime())) return val.toISOString();
    // String like "2024:10:15 14:30:00" — convert colons in date part
    if (typeof val === "string") {
      const fixed = val.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
      const d = new Date(fixed);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

export async function POST(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await initDb();

    const formData = await req.formData();
    const files = formData.getAll("photos");
    const faceResultsRaw = formData.get("faceResults");
    // FIX: accept manually entered location from client
    const manualLocation = formData.get("manualLocation") || null;

    let faceResultsMap = {};
    if (faceResultsRaw) {
      try {
        for (const r of JSON.parse(faceResultsRaw)) {
          faceResultsMap[r.name] = r;
        }
      } catch {}
    }

    if (!files?.length) return NextResponse.json({ error: "No files uploaded" }, { status: 400 });

    let userId = null;
    if (session.user.username !== "admin") {
      const r = await pool.query("SELECT id FROM users WHERE username = $1", [session.user.username]);
      userId = r.rows[0]?.id || null;
    }

    const uploadedPhotos = [];
    const touchedLocations = new Set();

    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const rawBuffer = Buffer.from(bytes);
      const filename = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
      const storagePath = `${session.user.username}/${filename}`;

      // ── VIDEO PATH ────────────────────────────────────────────────────────
      if (isVideo(file)) {
        const mimeType = file.type || "video/mp4";
        const { default: supabaseAdmin } = await import("@/lib/supabaseAdmin");
        if (!supabaseAdmin?.storage) continue;

        const { error: uploadError } = await supabaseAdmin.storage
          .from("photos")
          .upload(storagePath, rawBuffer, { contentType: mimeType, upsert: false });
        if (uploadError) { console.error("Video upload error:", uploadError); continue; }

        const { data: urlData } = supabaseAdmin.storage.from("photos").getPublicUrl(storagePath);
        const url = urlData.publicUrl;
        const description = buildVideoDescription(file.name);

        let embeddingValue = null;
        try { const emb = await embedText(description); embeddingValue = toSqlVector(emb); } catch {}

        await pool.query(
          `INSERT INTO photos (
            user_id, filename, url, uploaded_by, storage_path,
            mime_type, file_size, place_name,
            ai_description, embedding, needs_recaption
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector,$11) RETURNING id`,
          [
            userId, filename, url, session.user.username, storagePath,
            mimeType, file.size || null, manualLocation,
            description, embeddingValue, false,
          ]
        );

        uploadedPhotos.push({ filename, url, description, isVideo: true });
        continue;
      }

      // ── IMAGE PATH ────────────────────────────────────────────────────────

      let imageMeta = {};
      try { imageMeta = await sharp(rawBuffer).metadata(); } catch {}

      let uploadBuffer = rawBuffer;
      try {
        uploadBuffer = await sharp(rawBuffer)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85, progressive: true })
          .toBuffer();
      } catch {}

      // FIX: parse EXIF with all date tags included
      let exif = {};
      try {
        exif = await exifr.parse(rawBuffer, {
          gps: true,
          tiff: true,
          exif: true,
          // explicitly request all date fields
          pick: [
            "DateTimeOriginal", "CreateDate", "DateTime", "ModifyDate",
            "GPSDateTime", "Make", "Model",
            "GPSLatitude", "GPSLongitude", "latitude", "longitude",
          ],
        }) ?? {};
      } catch {}

      // FIX: use robust date extractor
      const dateTaken = extractExifDate(exif);

      // GPS → place name (prefer GPS over manual if available)
      let placeName = null;
      if (exif?.latitude && exif?.longitude) {
        placeName = await reverseGeocode(exif.latitude, exif.longitude);
      }
      // FIX: fall back to manually entered location if GPS not available
      if (!placeName && manualLocation) {
        placeName = manualLocation;
      }

      const { default: supabaseAdminDynamic } = await import("@/lib/supabaseAdmin");
      if (!supabaseAdminDynamic?.storage) continue;

      const { error: uploadError } = await supabaseAdminDynamic.storage
        .from("photos")
        .upload(storagePath, uploadBuffer, { contentType: "image/jpeg", upsert: false });
      if (uploadError) { console.error("Upload error:", uploadError); continue; }

      const { data: urlData } = supabaseAdminDynamic.storage.from("photos").getPublicUrl(storagePath);
      const url = urlData.publicUrl;

      const faceData = faceResultsMap[file.name] || {};
      const faceCount = faceData.faceCount ?? 0;
      const emotion = faceData.dominantEmotion ?? null;
      const descriptor = faceData.descriptor ?? null;

      const matchedPeople = await matchFaceToPeople(descriptor, session.user.username);
      const peopleNames = matchedPeople.map(p => p.name);

      let caption = null;
      try { caption = await captionImage(uploadBuffer); } catch (err) {
        console.error("Caption error:", err.message);
      }

      const { description, needsRecaption } = buildDescription({
        caption, filename: file.name, exif, faceCount, emotion, peopleNames, placeName,
      });

      let embeddingValue = null;
      try {
        const emb = await embedText(description);
        embeddingValue = toSqlVector(emb);
      } catch (err) { console.error("Embedding error:", err.message); }

      const inserted = await pool.query(
        `INSERT INTO photos (
          user_id, filename, url, uploaded_by, storage_path,
          mime_type, file_size, width, height, format,
          date_taken, camera_make, camera_model, latitude, longitude,
          place_name,
          face_count, dominant_emotion, ai_description, embedding, needs_recaption
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,
          $16,
          $17,$18,$19,$20::vector,$21
        ) RETURNING id`,
        [
          userId, filename, url, session.user.username, storagePath,
          "image/jpeg", file.size || null,
          imageMeta.width || null, imageMeta.height || null, imageMeta.format || null,
          // FIX: use properly extracted date instead of raw exif.DateTimeOriginal
          dateTaken,
          exif?.Make || null, exif?.Model || null,
          exif?.latitude || null, exif?.longitude || null,
          placeName || null,
          faceCount, emotion, description, embeddingValue, needsRecaption,
        ]
      );

      const photoId = inserted.rows[0].id;

      for (const person of matchedPeople) {
        await pool.query(
          "INSERT INTO photo_people (photo_id, person_id, confidence) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [photoId, person.id, person.confidence]
        );
      }

      if (placeName) {
        try { await syncLocationAlbum(session.user.username, photoId, placeName); } catch (err) {
          console.error("Location album sync error:", err.message);
        }
        touchedLocations.add(placeName);
      }

      uploadedPhotos.push({ filename, url, caption, description, peopleFound: peopleNames, isVideo: false });
    }

    for (const place of touchedLocations) {
      try { await syncLocationAlbum(session.user.username, place); } catch (err) {
        console.error(`Location album sync failed for "${place}":`, err);
      }
    }

    return NextResponse.json({ photos: uploadedPhotos }, { status: 201 });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}