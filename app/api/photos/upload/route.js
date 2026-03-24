// app/api/photos/upload/route.js — uses shared modules, no inline duplicates
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

      let exif = {};
      try { exif = await exifr.parse(rawBuffer, { gps: true }) ?? {}; } catch {}

      const { error: uploadError } = await supabaseAdmin.storage
        .from("photos")
        .upload(storagePath, uploadBuffer, { contentType: "image/jpeg", upsert: false });

      if (uploadError) { console.error("Upload error:", uploadError); continue; }

      const { data: urlData } = supabaseAdmin.storage.from("photos").getPublicUrl(storagePath);
      const url = urlData.publicUrl;

      const faceData = faceResultsMap[file.name] || {};
      const faceCount = faceData.faceCount ?? 0;
      const emotion = faceData.dominantEmotion ?? null;
      const descriptor = faceData.descriptor ?? null;

      const matchedPeople = await matchFaceToPeople(descriptor, session.user.username);
      const peopleNames = matchedPeople.map(p => p.name);

      // FIX: uses captionImage from lib/hf.js (has 503 retry logic) instead of inline captionWithBLIP
      let caption = null;
      try {
        caption = await captionImage(uploadBuffer);
      } catch (err) {
        console.error("BLIP caption error:", err.message);
      }

      // FIX: uses shared buildDescription from lib/description.js
      const { description, needsRecaption } = buildDescription({ caption, filename: file.name, exif, faceCount, emotion, peopleNames });

      // FIX: uses embedText/toSqlVector (not getEmbedding/embeddingToSql)
      let embeddingValue = null;
      try {
        const emb = await embedText(description);
        embeddingValue = toSqlVector(emb);
      } catch (err) {
        console.error("Embedding error:", err.message);
      }

      const inserted = await pool.query(
        `INSERT INTO photos (
          user_id, filename, url, uploaded_by, storage_path,
          mime_type, file_size, width, height, format,
          date_taken, camera_make, camera_model, latitude, longitude,
          face_count, dominant_emotion, ai_description, embedding, needs_recaption
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::vector,$20) RETURNING id`,
        [
          userId, filename, url, session.user.username, storagePath,
          "image/jpeg", file.size || null,
          imageMeta.width || null, imageMeta.height || null, imageMeta.format || null,
          exif?.DateTimeOriginal || null, exif?.Make || null, exif?.Model || null,
          exif?.latitude || null, exif?.longitude || null,
          faceCount, emotion, description, embeddingValue,needsRecaption
        ]
      );

      const photoId = inserted.rows[0].id;

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