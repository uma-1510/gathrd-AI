// app/api/debug/reindex/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import supabaseAdmin from "@/lib/supabaseAdmin";
import { captionImage, embedText, toSqlVector } from "@/lib/hf";
import { buildDescription } from "@/lib/description";


// GET /api/debug/reindex?limit=50&force=true&recaption=true
export async function GET(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") ?? "10");
    const force = searchParams.get("force") === "true";
    const recaptionOnly = searchParams.get("recaption") === "true";

    // Target: force=all, recaption=flagged photos, default=missing embeddings/descriptions
    let whereClause;
    if (force) {
      whereClause = "WHERE p.uploaded_by = $1";
    } else if (recaptionOnly) {
      whereClause = "WHERE p.uploaded_by = $1 AND (p.needs_recaption = true OR p.ai_description LIKE 'Photo:%')";
    } else {
      whereClause = "WHERE p.uploaded_by = $1 AND (p.embedding IS NULL OR p.ai_description IS NULL OR p.needs_recaption = true)";
    }

    const photos = await pool.query(
      `SELECT p.id, p.filename, p.storage_path, p.camera_make, p.camera_model,
              p.date_taken, p.face_count, p.dominant_emotion, p.latitude, p.longitude,
              p.ai_description, p.needs_recaption
       FROM photos p
       ${whereClause}
       ORDER BY p.uploaded_at DESC LIMIT $2`,
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

        // BLIP caption (with retry via lib/hf.js)
        let caption = null;
        try {
          caption = await captionImage(imageBuffer);
        } catch (err) {
          console.error(`BLIP failed for photo ${photo.id}:`, err.message);
        }

        // Get people names tagged to this photo (from both tables)
        const peopleResult = await pool.query(
          `SELECT DISTINCT per.name FROM people per WHERE per.username = $2
             AND (EXISTS (SELECT 1 FROM photo_people pp WHERE pp.photo_id = $1 AND pp.person_id = per.id)
               OR EXISTS (SELECT 1 FROM face_tags ft WHERE ft.photo_id = $1 AND ft.person_id = per.id))`,
          [photo.id, session.user.username]
        );
        const peopleNames = peopleResult.rows.map(r => r.name);

        // Build description with Phase 2 enrichment
        const { description, needsRecaption } = buildDescription({
          caption,
          filename: photo.filename,
          exif: {
            DateTimeOriginal: photo.date_taken,
            Make: photo.camera_make,
            Model: photo.camera_model,
            latitude: photo.latitude,
            longitude: photo.longitude,
          },
          faceCount: photo.face_count || 0,
          emotion: photo.dominant_emotion,
          peopleNames,
        });

        // Embed
        let embeddingValue = null;
        try {
          const vec = await embedText(description);
          embeddingValue = toSqlVector(vec);
        } catch (err) {
          console.error(`Embedding failed for photo ${photo.id}:`, err.message);
        }

        // Update DB — clear needs_recaption flag if we got a good caption
        await pool.query(
          `UPDATE photos SET ai_description = $1, embedding = $2::vector, needs_recaption = $3 WHERE id = $4`,
          [description, embeddingValue, needsRecaption, photo.id]
        );

        entry.status = "indexed";
        entry.caption = caption || "(fallback)";
        entry.description = description;
        entry.needsRecaption = needsRecaption;
        entry.hasEmbedding = !!embeddingValue;
        entry.peopleFound = peopleNames;
      } catch (err) {
        entry.status = "error";
        entry.error = err.message;
      }
      results.push(entry);
    }

    return NextResponse.json({
      processed: results.length,
      indexed: results.filter(r => r.status === "indexed").length,
      stillNeedRecaption: results.filter(r => r.needsRecaption).length,
      errors: results.filter(r => r.status === "error").length,
      results,
    });
  } catch (err) {
    console.error("Reindex error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}