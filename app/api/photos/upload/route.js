// app/api/photos/upload/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabaseAdmin from "@/lib/supabaseAdmin";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";
import sharp from "sharp";
import * as exifr from "exifr";
import { captionImage, embedText, toSqlVector } from "@/lib/hf";
import { buildDescription } from "@/lib/description";
import { matchFaceToPeople } from "@/lib/faceMatcher";

const VIDEO_MIME_TYPES = new Set([
  "video/mp4", "video/quicktime", "video/x-msvideo",
  "video/webm", "video/x-matroska", "video/mpeg",
]);
const VIDEO_EXTENSIONS = /\.(mp4|mov|avi|webm|mkv|mpeg|mpg)$/i;

function isVideo(file) {
  return VIDEO_MIME_TYPES.has(file.type) || VIDEO_EXTENSIONS.test(file.name);
}

// ── Reverse geocode coordinates → human-readable place name ──────────────────
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

// ── Generate a plain-text description for a video (no vision API needed) ─────
function buildVideoDescription(filename) {
  const cleanName = filename
    .replace(/\.[^.]+$/, "")         // strip extension
    .replace(/[_-]/g, " ")           // underscores/dashes → spaces
    .replace(/\d{13}[-_]?/g, "")     // strip timestamp prefixes
    .trim();
  return `A video clip${cleanName ? `: ${cleanName}` : ""}.`;
}

export async function POST(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await initDb();

    const formData = await req.formData();
    const files = formData.getAll("photos");
    const faceResultsRaw = formData.get("faceResults");

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

    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const rawBuffer = Buffer.from(bytes);
      const filename = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
      const storagePath = `${session.user.username}/${filename}`;

      // ── VIDEO PATH ────────────────────────────────────────────────────────
      if (isVideo(file)) {
        const mimeType = file.type || "video/mp4";

        const { error: uploadError } = await supabaseAdmin.storage
          .from("photos")
          .upload(storagePath, rawBuffer, { contentType: mimeType, upsert: false });

        if (uploadError) {
          console.error("Video upload error:", uploadError);
          continue;
        }

        const { data: urlData } = supabaseAdmin.storage.from("photos").getPublicUrl(storagePath);
        const url = urlData.publicUrl;

        // Simple text description for video — no vision API
        const description = buildVideoDescription(file.name);

        let embeddingValue = null;
        try {
          const emb = await embedText(description);
          embeddingValue = toSqlVector(emb);
        } catch {}

        const inserted = await pool.query(
          `INSERT INTO photos (
            user_id, filename, url, uploaded_by, storage_path,
            mime_type, file_size,
            ai_description, embedding, needs_recaption
          ) VALUES (
            $1,$2,$3,$4,$5,
            $6,$7,
            $8,$9::vector,$10
          ) RETURNING id`,
          [
            userId, filename, url, session.user.username, storagePath,
            mimeType, file.size || null,
            description, embeddingValue, false,
          ]
        );

        uploadedPhotos.push({ filename, url, description, isVideo: true });
        continue;
      }

      // ── IMAGE PATH ────────────────────────────────────────────────────────

      // Sharp metadata
      let imageMeta = {};
      try { imageMeta = await sharp(rawBuffer).metadata(); } catch {}

      // Compress for upload
      let uploadBuffer = rawBuffer;
      try {
        uploadBuffer = await sharp(rawBuffer)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85, progressive: true })
          .toBuffer();
      } catch {}

      // EXIF
      let exif = {};
      try { exif = await exifr.parse(rawBuffer, { gps: true }) ?? {}; } catch {}

      // Reverse geocode GPS → place name
      let placeName = null;
      if (exif?.latitude && exif?.longitude) {
        placeName = await reverseGeocode(exif.latitude, exif.longitude);
      }

      // Upload to Supabase
    const { default: supabaseAdmin } = await import("@/lib/supabaseAdmin");
if (!supabaseAdmin?.storage) {
  console.error("supabaseAdmin.storage unavailable — check SUPABASE_SERVICE_ROLE_KEY");
  continue;
}

const { error: uploadError } = await supabaseAdmin.storage
  .from("photos")
  .upload(storagePath, uploadBuffer, { contentType: "image/jpeg", upsert: false });

if (uploadError) { console.error("Upload error:", uploadError); continue; }

const { data: urlData } = supabaseAdmin.storage.from("photos").getPublicUrl(storagePath);
      const url = urlData.publicUrl;

      // Face data from client
      const faceData = faceResultsMap[file.name] || {};
      const faceCount = faceData.faceCount ?? 0;
      const emotion = faceData.dominantEmotion ?? null;
      const descriptor = faceData.descriptor ?? null;

      // Match against known people
      const matchedPeople = await matchFaceToPeople(descriptor, session.user.username);
      const peopleNames = matchedPeople.map(p => p.name);

      // AI caption via GPT-4o-mini vision
      let caption = null;
      try {
        caption = await captionImage(uploadBuffer);
      } catch (err) {
        console.error("Caption error:", err.message);
      }

      // Build description
      const { description, needsRecaption } = buildDescription({
        caption,
        filename: file.name,
        exif,
        faceCount,
        emotion,
        peopleNames,
        placeName,
      });

      // Embed description
      let embeddingValue = null;
      try {
        const emb = await embedText(description);
        embeddingValue = toSqlVector(emb);
      } catch (err) {
        console.error("Embedding error:", err.message);
      }

      // DB insert
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
          exif?.DateTimeOriginal || null, exif?.Make || null, exif?.Model || null,
          exif?.latitude || null, exif?.longitude || null,
          placeName || null,
          faceCount, emotion, description, embeddingValue, needsRecaption,
        ]
      );

      const photoId = inserted.rows[0].id;

      // Link to matched people
      for (const person of matchedPeople) {
        await pool.query(
          "INSERT INTO photo_people (photo_id, person_id, confidence) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [photoId, person.id, person.confidence]
        );
      }

      uploadedPhotos.push({ filename, url, caption, description, peopleFound: peopleNames, isVideo: false });
    }

    return NextResponse.json({ photos: uploadedPhotos }, { status: 201 });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}