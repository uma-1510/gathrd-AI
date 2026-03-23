import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

// GET /api/debug/photos
// Returns AI metadata for all your photos so you can see what's stored
export async function GET() {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await pool.query(
      `SELECT
         id,
         filename,
         url,
         storage_path,
         uploaded_at,
         ai_description,
         face_count,
         dominant_emotion,
         CASE WHEN embedding IS NOT NULL THEN true ELSE false END AS has_embedding
       FROM photos
       WHERE uploaded_by = $1
       ORDER BY uploaded_at DESC`,
      [session.user.username]
    );

    const summary = {
      total: result.rows.length,
      with_description: result.rows.filter(r => r.ai_description).length,
      with_embedding: result.rows.filter(r => r.has_embedding).length,
      without_description: result.rows.filter(r => !r.ai_description).length,
      photos: result.rows,
    };

    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}