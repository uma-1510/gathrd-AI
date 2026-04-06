// app/api/photos/upload/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import getSupabaseAdmin from "@/lib/supabaseAdmin";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";
import sharp from "sharp";
import * as exifr from "exifr";
import { captionImage, embedText, toSqlVector } from "@/lib/hf";
import { buildDescription } from "@/lib/description";
import { matchFaceToPeople } from "@/lib/faceMatcher";

// ── Reverse geocode coordinates → human-readable place name ──────────────────
// Uses OpenStreetMap Nominatim — free, no API key required.
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

      // ── Sharp metadata ────────────────────────────────────────────────────
      let imageMeta = {};
      try { imageMeta = await sharp(rawBuffer).metadata(); } catch {}

      // ── Compress for upload ───────────────────────────────────────────────
      let uploadBuffer = rawBuffer;
      try {
        uploadBuffer = await sharp(rawBuffer)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85, progressive: true })
          .toBuffer();
      } catch {}

      // ── EXIF ─────────────────────────────────────────────────────────────
      let exif = {};
      try { exif = await exifr.parse(rawBuffer, { gps: true }) ?? {}; } catch {}

      // ── Reverse geocode GPS → place name ──────────────────────────────────
      let placeName = null;
      if (exif?.latitude && exif?.longitude) {
        placeName = await reverseGeocode(exif.latitude, exif.longitude);
      }

      // ── Upload to Supabase ────────────────────────────────────────────────
      const { error: uploadError } = await getSupabaseAdmin.storage
        .from("photos")
        .upload(storagePath, uploadBuffer, { contentType: "image/jpeg", upsert: false });

      if (uploadError) { console.error("Upload error:", uploadError); continue; }

      const { data: urlData } = getSupabaseAdmin.storage.from("photos").getPublicUrl(storagePath);
      const url = urlData.publicUrl;

      // ── Face data from client ─────────────────────────────────────────────
      const faceData = faceResultsMap[file.name] || {};
      const faceCount = faceData.faceCount ?? 0;
      const emotion = faceData.dominantEmotion ?? null;
      const descriptor = faceData.descriptor ?? null;

      // ── Match against known people ────────────────────────────────────────
      const matchedPeople = await matchFaceToPeople(descriptor, session.user.username);
      const peopleNames = matchedPeople.map(p => p.name);

      // ── BLIP visual caption ───────────────────────────────────────────────
      let caption = null;
      try {
        caption = await captionImage(uploadBuffer);
      } catch (err) {
        console.error("BLIP caption error:", err.message);
      }

      // ── Build description (from lib/description.js) ───────────────────────
      const { description, needsRecaption } = buildDescription({
        caption,
        filename: file.name,
        exif,
        faceCount,
        emotion,
        peopleNames,
        placeName,
      });

      // ── Embed description ─────────────────────────────────────────────────
      let embeddingValue = null;
      try {
        const emb = await embedText(description);
        embeddingValue = toSqlVector(emb);
      } catch (err) {
        console.error("Embedding error:", err.message);
      }

      // ── DB insert ─────────────────────────────────────────────────────────
      // Columns:  $1  user_id
      //           $2  filename
      //           $3  url
      //           $4  uploaded_by
      //           $5  storage_path
      //           $6  mime_type
      //           $7  file_size
      //           $8  width
      //           $9  height
      //           $10 format
      //           $11 date_taken
      //           $12 camera_make
      //           $13 camera_model
      //           $14 latitude
      //           $15 longitude
      //           $16 place_name          ← new
      //           $17 face_count
      //           $18 dominant_emotion
      //           $19 ai_description
      //           $20 embedding
      //           $21 needs_recaption
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
      
      // Score immediately — no extra API call, pure computation
const { scorePhoto } = await import("@/lib/scoring");
const score = scorePhoto({
  dominant_emotion: emotion,
  face_count: faceCount,
  width: imageMeta.width,
  height: imageMeta.height,
  place_name: placeName,
  ai_description: description,
  people: peopleNames,
});
await pool.query("UPDATE photos SET content_score = $1 WHERE id = $2", [score, photoId]);

      // ── Link to matched people ────────────────────────────────────────────
      for (const person of matchedPeople) {
        await pool.query(
          "INSERT INTO photo_people (photo_id, person_id, confidence) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [photoId, person.id, person.confidence]
        );
      }

      uploadedPhotos.push({ filename, url, caption, description, peopleFound: peopleNames });
    }

    return NextResponse.json({ photos: uploadedPhotos }, { status: 201 });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}