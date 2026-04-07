// app/api/photos/score/route.js
// POST — computes and saves content_score for all photos missing it.
// GET  — returns top-scoring photos for the current user.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { scorePhoto, scoreTier } from "@/lib/scoring";

export async function POST(req) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const username = session.user.username;

  // Fetch all photos needing a score (score = 0 means unscored)
  const res = await pool.query(
    `SELECT p.id, p.dominant_emotion, p.face_count, p.width, p.height,
            p.place_name, p.ai_description,
            ARRAY_AGG(per.name) FILTER (WHERE per.name IS NOT NULL) AS people
     FROM photos p
     LEFT JOIN photo_people pp ON pp.photo_id = p.id
     LEFT JOIN people per ON per.id = pp.person_id AND per.username = $1
     WHERE p.uploaded_by = $1 AND (p.content_score IS NULL OR p.content_score = 0)
     GROUP BY p.id`,
    [username]
  );

  let updated = 0;
  for (const photo of res.rows) {
    const score = scorePhoto(photo);
    await pool.query(
      "UPDATE photos SET content_score = $1 WHERE id = $2",
      [score, photo.id]
    );
    updated++;
  }

  return NextResponse.json({ updated });
}

export async function GET(req) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const username = session.user.username;

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "20");
  const minScore = parseInt(searchParams.get("min") || "60");

  const res = await pool.query(
    `SELECT id, url, filename, content_score, dominant_emotion,
            face_count, place_name, date_taken
     FROM photos
     WHERE uploaded_by = $1 AND content_score >= $2
     ORDER BY content_score DESC
     LIMIT $3`,
    [username, minScore, limit]
  );

  return NextResponse.json({
    photos: res.rows.map(p => ({ ...p, tier: scoreTier(p.content_score) })),
  });
}