// app/api/debug/reindex/route.js
// Re-indexes existing photos: BLIP caption + HF embedding
// Run once after setup: GET /api/debug/reindex?limit=50
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import supabaseAdmin from "@/lib/supabaseAdmin";
import { captionImage, embedText, toSqlVector } from "@/lib/hf";

async function captionWithBLIP(imageBuffer) {
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
  if (!res.ok) throw new Error(`BLIP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (Array.isArray(data) ? data[0]?.generated_text : data?.generated_text) || null;
}

function buildDescription(caption, photo) {
  const parts = [];
  if (caption) {
    parts.push(caption + ".");
  } else {
    const cleaned = photo.filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
    parts.push(`Photo: ${cleaned}.`);
  }
  if (photo.date_taken) {
    parts.push(`Taken on ${new Date(photo.date_taken).toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric"
    })}.`);
  }
  if (photo.camera_make) {
    parts.push(`Shot on ${photo.camera_make}${photo.camera_model ? " " + photo.camera_model : ""}.`);
  }
  if (photo.face_count > 0) {
    const emotionText = photo.dominant_emotion && photo.dominant_emotion !== "neutral"
      ? `, appearing ${photo.dominant_emotion}` : "";
    parts.push(`${photo.face_count === 1 ? "One person" : `${photo.face_count} people`} visible${emotionText}.`);
  }
  return parts.join(" ");
}

export async function GET(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") ?? "10");
    const force = searchParams.get("force") === "true";

    const whereClause = force
      ? "WHERE uploaded_by = $1"
      : "WHERE uploaded_by = $1 AND (ai_description IS NULL OR embedding IS NULL)";

    const photos = await pool.query(
      `SELECT id, filename, storage_path, camera_make, camera_model,
              date_taken, face_count, dominant_emotion
       FROM photos
       ${whereClause}
       ORDER BY uploaded_at DESC LIMIT $2`,
      [session.user.username, limit]
    );

    if (!photos.rows.length) {
      return NextResponse.json({ message: "All photos already indexed", processed: 0 });
    }

    const results = [];

    for (const photo of photos.rows) {
      const entry = { id: photo.id, filename: photo.filename, status: "skipped" };
      try {
        if (!photo.storage_path) { entry.status = "no_storage_path"; results.push(entry); continue; }

        // Download from Supabase
        const { data: fileData, error: dlErr } = await supabaseAdmin.storage
          .from("photos").download(photo.storage_path);
        if (dlErr || !fileData) { entry.status = "download_error"; entry.error = dlErr?.message; results.push(entry); continue; }

        const imageBuffer = Buffer.from(await fileData.arrayBuffer());

        const caption = await captionWithBLIP(imageBuffer);
        const description = buildDescription(caption, photo);
        const embedding = await getEmbedding(description);

        await pool.query(
          "UPDATE photos SET ai_description = $1, embedding = $2::vector WHERE id = $3",
          [description, embeddingToSql(embedding), photo.id]
        );

        entry.status = "indexed";
        entry.caption = caption;
        entry.description = description;
      } catch (err) {
        entry.status = "error";
        entry.error = err.message;
      }
      results.push(entry);
    }

    return NextResponse.json({
      processed: results.length,
      indexed: results.filter(r => r.status === "indexed").length,
      errors: results.filter(r => r.status === "error").length,
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}