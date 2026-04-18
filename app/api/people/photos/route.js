// app/api/people/photos/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

export async function GET(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const personId = searchParams.get("personId");
    if (!personId) return NextResponse.json({ error: "personId required" }, { status: 400 });

    const username = session.user.username;

    // Verify person belongs to this user
    const personCheck = await pool.query(
      "SELECT id, name FROM people WHERE id = $1 AND username = $2",
      [personId, username]
    );
    if (!personCheck.rows.length) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    const result = await pool.query(
      `SELECT DISTINCT p.id, p.url, p.filename, p.ai_description,
              p.dominant_emotion, p.place_name,
              COALESCE(p.date_taken, p.uploaded_at) AS sort_date
       FROM photos p
       WHERE p.uploaded_by = $1
         AND (
           EXISTS (SELECT 1 FROM photo_people pp WHERE pp.photo_id = p.id AND pp.person_id = $2)
           OR
           EXISTS (SELECT 1 FROM face_tags ft WHERE ft.photo_id = p.id AND ft.person_id = $2)
         )
       ORDER BY sort_date DESC
       LIMIT 100`,
      [username, personId]
    );

    return NextResponse.json({ photos: result.rows, count: result.rows.length });
  } catch (err) {
    console.error("GET /api/people/photos error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}