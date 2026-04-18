// app/api/people/reassign/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { embedText, toSqlVector } from "@/lib/hf";
import { updateDescriptionWithPeople } from "@/lib/description";

async function reEmbedPhoto(photoId, username) {
  try {
    const photo = await pool.query(
      "SELECT ai_description FROM photos WHERE id=$1 AND uploaded_by=$2",
      [photoId, username]
    );
    if (!photo.rows.length) return;
    const taggedPeople = await pool.query(
      `SELECT DISTINCT per.name FROM people per WHERE per.username=$1
         AND (EXISTS (SELECT 1 FROM photo_people pp WHERE pp.photo_id=$2 AND pp.person_id=per.id)
           OR EXISTS (SELECT 1 FROM face_tags ft WHERE ft.photo_id=$2 AND ft.person_id=per.id))`,
      [username, photoId]
    );
    const newDesc = updateDescriptionWithPeople(photo.rows[0].ai_description, taggedPeople.rows.map(r => r.name));
    try {
      const vec = await embedText(newDesc);
      await pool.query("UPDATE photos SET ai_description=$1, embedding=$2::vector WHERE id=$3", [newDesc, toSqlVector(vec), photoId]);
    } catch {
      await pool.query("UPDATE photos SET ai_description=$1 WHERE id=$2", [newDesc, photoId]);
    }
  } catch (err) {
    console.error(`reEmbedPhoto error for ${photoId}:`, err.message);
  }
}

// POST — move photos from one person to another (create target person if needed)
export async function POST(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { fromPersonId, toPersonName, photoIds } = await req.json();
    if (!fromPersonId || !toPersonName?.trim() || !photoIds?.length)
      return NextResponse.json({ error: "fromPersonId, toPersonName, and photoIds required" }, { status: 400 });

    const username = session.user.username;

    // Verify source person belongs to this user
    const fromCheck = await pool.query(
      "SELECT id FROM people WHERE id=$1 AND username=$2",
      [fromPersonId, username]
    );
    if (!fromCheck.rows.length) return NextResponse.json({ error: "Source person not found" }, { status: 404 });

    // Find or create target person
    let toPerson = await pool.query(
      "SELECT id FROM people WHERE username=$1 AND name ILIKE $2 LIMIT 1",
      [username, toPersonName.trim()]
    );

    let toPersonId;
    if (toPerson.rows.length) {
      toPersonId = toPerson.rows[0].id;
    } else {
      // Create new person with placeholder descriptor
      const created = await pool.query(
        "INSERT INTO people (username, name, face_descriptor) VALUES ($1,$2,$3) RETURNING id",
        [username, toPersonName.trim(), Array(128).fill(0)]
      );
      toPersonId = created.rows[0].id;
    }

    // Reassign each photo
    for (const photoId of photoIds) {
      // Remove from source
      await pool.query("DELETE FROM photo_people WHERE photo_id=$1 AND person_id=$2", [photoId, fromPersonId]);
      await pool.query("DELETE FROM face_tags WHERE photo_id=$1 AND person_id=$2", [photoId, fromPersonId]);
      // Add to target
      await pool.query(
        "INSERT INTO photo_people (photo_id,person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [photoId, toPersonId]
      );
      // Re-embed both photos
      await reEmbedPhoto(photoId, username);
    }

    return NextResponse.json({ message: `Moved ${photoIds.length} photo(s) to ${toPersonName.trim()}`, toPersonId });
  } catch (err) {
    console.error("POST /api/people/reassign error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}