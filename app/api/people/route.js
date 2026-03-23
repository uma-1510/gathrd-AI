// app/api/people/route.js
// CRUD for named people (tagged faces)
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

// GET /api/people — list all named people for this user
export async function GET() {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await pool.query(
      `SELECT p.id, p.name, p.cover_photo_url, p.created_at,
              COUNT(pp.photo_id)::int AS photo_count
       FROM people p
       LEFT JOIN photo_people pp ON pp.person_id = p.id
       WHERE p.username = $1
       GROUP BY p.id
       ORDER BY p.name ASC`,
      [session.user.username]
    );

    return NextResponse.json({ people: result.rows });
  } catch (err) {
    console.error("GET /api/people error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/people — create or update a named person
// Body: { name, faceDescriptor: number[], coverPhotoUrl?, photoIds?: number[] }
export async function POST(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { name, faceDescriptor, coverPhotoUrl, photoIds } = await req.json();

    if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
    if (!Array.isArray(faceDescriptor) || faceDescriptor.length === 0) {
      return NextResponse.json({ error: "faceDescriptor required" }, { status: 400 });
    }

    const username = session.user.username;

    // Upsert person
    const result = await pool.query(
      `INSERT INTO people (username, name, face_descriptor, cover_photo_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username, name)
       DO UPDATE SET face_descriptor = $3, cover_photo_url = COALESCE($4, people.cover_photo_url)
       RETURNING *`,
      [username, name.trim(), faceDescriptor, coverPhotoUrl || null]
    );

    const person = result.rows[0];

    // Link photos to this person
    if (photoIds?.length) {
      for (const photoId of photoIds) {
        await pool.query(
          `INSERT INTO photo_people (photo_id, person_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [photoId, person.id]
        );
      }
    }

    return NextResponse.json({ person }, { status: 201 });
  } catch (err) {
    console.error("POST /api/people error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}