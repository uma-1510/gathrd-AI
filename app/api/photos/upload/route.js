// app/api/photos/upload/route.js
// Full pipeline: compress → BLIP caption → HF embed → face data → DB insert
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabaseAdmin from "@/lib/supabaseAdmin";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";
import sharp from "sharp";
import * as exifr from "exifr";
import { captionImage, embedText, toSqlVector } from "@/lib/hf";

// ── BLIP image captioning ─────────────────────────────────────────────────────
async function captionWithBLIP(imageBuffer) {
  if (!process.env.HUGGINGFACE_API_KEY) return null;
  try {
    const res = await fetch(
      "https://router.huggingface.co/hf-inference/models/Salesforce/blip-image-captioning-large",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/octet-stream",
        },
        body: imageBuffer,
      }
    );
    if (!res.ok) { console.error("BLIP error:", res.status, await res.text()); return null; }
    const data = await res.json();
    return (Array.isArray(data) ? data[0]?.generated_text : data?.generated_text) || null;
  } catch (err) {
    console.error("BLIP caption error:", err.message);
    return null;
  }
}

// ── Build rich description from caption + metadata + people ──────────────────
function buildDescription({ caption, filename, exif, faceCount, emotion, peopleNames }) {
  const parts = [];

  if (caption) {
    parts.push(caption + ".");
  } else {
    const cleaned = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
    if (cleaned) parts.push(`Photo: ${cleaned}.`);
  }

  if (exif?.DateTimeOriginal) {
    parts.push(`Taken on ${new Date(exif.DateTimeOriginal).toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    })}.`);
  }

  if (exif?.Make) {
    parts.push(`Shot on ${exif.Make}${exif.Model ? " " + exif.Model : ""}.`);
  }

  if (peopleNames?.length) {
    parts.push(`People in photo: ${peopleNames.join(", ")}.`);
  } else if (faceCount > 0) {
    const emotionText = emotion && emotion !== "neutral" ? `, appearing ${emotion}` : "";
    parts.push(`${faceCount === 1 ? "One person" : `${faceCount} people`} visible${emotionText}.`);
  }

  if (exif?.latitude && exif?.longitude) {
    parts.push(`GPS: ${Number(exif.latitude).toFixed(4)}, ${Number(exif.longitude).toFixed(4)}.`);
  }

  return parts.join(" ");
}

// ── Match face descriptor against known people ────────────────────────────────
function euclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

async function matchFaceToPeople(descriptor, username) {
  if (!descriptor?.length) return [];
  const people = await pool.query(
    "SELECT id, name, face_descriptor FROM people WHERE username = $1",
    [username]
  );
  const matches = [];
  for (const person of people.rows) {
    const dist = euclidean(descriptor, person.face_descriptor);
    if (dist < 0.6) { // threshold: lower = stricter
      matches.push({ id: person.id, name: person.name, confidence: +(1 - dist / 0.6).toFixed(3) });
    }
  }
  return matches.sort((a, b) => b.confidence - a.confidence);
}

// ── Main upload handler ───────────────────────────────────────────────────────
export async function POST(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await initDb();

    const formData = await req.formData();
    const files = formData.getAll("photos");
    const faceResultsRaw = formData.get("faceResults");

    // Parse client-side face results: [{ name, faceCount, dominantEmotion, descriptor }]
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

      // ── Sharp metadata ──────────────────────────────────────────────────
      let imageMeta = {};
      try { imageMeta = await sharp(rawBuffer).metadata(); } catch {}

      // ── Compress for upload (max 1600px, JPEG 85) ───────────────────────
      let uploadBuffer = rawBuffer;
      try {
        uploadBuffer = await sharp(rawBuffer)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85, progressive: true })
          .toBuffer();
      } catch {}

      // ── EXIF ────────────────────────────────────────────────────────────
      let exif = {};
      try { exif = await exifr.parse(rawBuffer, { gps: true }) ?? {}; } catch {}

      // ── Upload to Supabase ──────────────────────────────────────────────
      const { error: uploadError } = await supabaseAdmin.storage
        .from("photos")
        .upload(storagePath, uploadBuffer, { contentType: "image/jpeg", upsert: false });

      if (uploadError) { console.error("Upload error:", uploadError); continue; }

      const { data: urlData } = supabaseAdmin.storage.from("photos").getPublicUrl(storagePath);
      const url = urlData.publicUrl;

      // ── Face data from client ───────────────────────────────────────────
      const faceData = faceResultsMap[file.name] || {};
      const faceCount = faceData.faceCount ?? 0;
      const emotion = faceData.dominantEmotion ?? null;
      const descriptor = faceData.descriptor ?? null;

      // ── Match against known people ──────────────────────────────────────
      const matchedPeople = await matchFaceToPeople(descriptor, session.user.username);
      const peopleNames = matchedPeople.map(p => p.name);

      // ── BLIP visual caption ─────────────────────────────────────────────
      const caption = await captionWithBLIP(uploadBuffer);

      // ── Build description ───────────────────────────────────────────────
      const description = buildDescription({
        caption, filename: file.name, exif, faceCount, emotion, peopleNames
      });

      // ── Embed description ───────────────────────────────────────────────
      let embeddingValue = null;
      try {
        const emb = await getEmbedding(description);
        embeddingValue = embeddingToSql(emb);
      } catch (err) {
        console.error("Embedding error:", err.message);
      }

      // ── DB insert ───────────────────────────────────────────────────────
      const inserted = await pool.query(
        `INSERT INTO photos (
          user_id, filename, url, uploaded_by, storage_path,
          mime_type, file_size, width, height, format,
          date_taken, camera_make, camera_model, latitude, longitude,
          face_count, dominant_emotion, ai_description, embedding
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::vector
        ) RETURNING id`,
        [
          userId, filename, url, session.user.username, storagePath,
          "image/jpeg", file.size || null,
          imageMeta.width || null, imageMeta.height || null, imageMeta.format || null,
          exif?.DateTimeOriginal || null, exif?.Make || null, exif?.Model || null,
          exif?.latitude || null, exif?.longitude || null,
          faceCount, emotion, description, embeddingValue,
        ]
      );

      const photoId = inserted.rows[0].id;

      // ── Link to matched people ──────────────────────────────────────────
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