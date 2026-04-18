// app/api/people/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { embedText, toSqlVector } from "@/lib/hf";
import { updateDescriptionWithPeople } from "@/lib/description";

async function reEmbedPhoto(photoId, username) {
  try {
    const photo = await pool.query(
      "SELECT ai_description FROM photos WHERE id = $1 AND uploaded_by = $2",
      [photoId, username]
    );
    if (!photo.rows.length) return;
    const taggedPeople = await pool.query(
      `SELECT DISTINCT per.name FROM people per WHERE per.username = $1
         AND (EXISTS (SELECT 1 FROM photo_people pp WHERE pp.photo_id = $2 AND pp.person_id = per.id)
           OR EXISTS (SELECT 1 FROM face_tags ft WHERE ft.photo_id = $2 AND ft.person_id = per.id))`,
      [username, photoId]
    );
    const personNames = taggedPeople.rows.map(r => r.name);
    const newDesc = updateDescriptionWithPeople(photo.rows[0].ai_description, personNames);
    try {
      const vec = await embedText(newDesc);
      await pool.query("UPDATE photos SET ai_description = $1, embedding = $2::vector WHERE id = $3", [newDesc, toSqlVector(vec), photoId]);
    } catch {
      await pool.query("UPDATE photos SET ai_description = $1 WHERE id = $2", [newDesc, photoId]);
    }
  } catch (err) {
    console.error(`reEmbedPhoto error for photo ${photoId}:`, err.message);
  }
}

// GET — list all named people with face_descriptor for client-side matching
export async function GET() {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await pool.query(
      `SELECT p.id, p.name, p.cover_photo_url, p.created_at, p.is_self, p.face_descriptor,
              COUNT(pp.photo_id)::int AS photo_count
       FROM people p
       LEFT JOIN (SELECT person_id, photo_id FROM photo_people UNION SELECT person_id, photo_id FROM face_tags) pp ON pp.person_id = p.id
       WHERE p.username = $1
       GROUP BY p.id ORDER BY p.name ASC`,
      [session.user.username]
    );
    return NextResponse.json({ people: result.rows });
  } catch (err) {
    console.error("GET /api/people error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST — create, upsert, or merge a person with photos
export async function POST(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { name, faceDescriptor, coverPhotoUrl, photoIds, existingPersonId, isMe } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
    if (!Array.isArray(faceDescriptor) || !faceDescriptor.length)
      return NextResponse.json({ error: "faceDescriptor required" }, { status: 400 });

    const username = session.user.username;
    let person;

    if (existingPersonId) {
      // Merge into existing person
      const updated = await pool.query(
        `UPDATE people SET name=$1, face_descriptor=$2, cover_photo_url=COALESCE($3,cover_photo_url),
           is_self=CASE WHEN $4=true THEN true ELSE is_self END
         WHERE id=$5 AND username=$6 RETURNING *`,
        [name.trim(), faceDescriptor, coverPhotoUrl || null, isMe === true, existingPersonId, username]
      );
      person = updated.rows[0];
    } else {
      // Create or upsert
      const upserted = await pool.query(
        `INSERT INTO people (username,name,face_descriptor,cover_photo_url,is_self) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (username,name) DO UPDATE SET
           face_descriptor=$3, cover_photo_url=COALESCE($4,people.cover_photo_url),
           is_self=CASE WHEN $5=true THEN true ELSE people.is_self END
         RETURNING *`,
        [username, name.trim(), faceDescriptor, coverPhotoUrl || null, isMe === true]
      );
      person = upserted.rows[0];
    }

    if (photoIds?.length) {
      for (const photoId of photoIds) {
        await pool.query("DELETE FROM photo_people WHERE photo_id=$1 AND person_id=$2", [photoId, person.id]);
        await pool.query("DELETE FROM face_tags WHERE photo_id=$1 AND person_id=$2", [photoId, person.id]);
        await pool.query("INSERT INTO photo_people (photo_id,person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [photoId, person.id]);
        await reEmbedPhoto(photoId, username);
      }
    }

    return NextResponse.json({ person }, { status: 201 });
  } catch (err) {
    console.error("POST /api/people error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE — remove person entirely, or untag from specific photos
export async function DELETE(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { personId, photoIds } = await req.json();
    if (!personId) return NextResponse.json({ error: "personId required" }, { status: 400 });
    const username = session.user.username;
    const personCheck = await pool.query("SELECT id FROM people WHERE id=$1 AND username=$2", [personId, username]);
    if (!personCheck.rows.length) return NextResponse.json({ error: "Person not found" }, { status: 404 });

    if (photoIds?.length) {
      for (const photoId of photoIds) {
        await pool.query("DELETE FROM photo_people WHERE photo_id=$1 AND person_id=$2", [photoId, personId]);
        await pool.query("DELETE FROM face_tags WHERE photo_id=$1 AND person_id=$2", [photoId, personId]);
        await reEmbedPhoto(photoId, username);
      }
    } else {
      const allPhotos = await pool.query(
        `SELECT DISTINCT photo_id FROM photo_people WHERE person_id=$1 UNION SELECT DISTINCT photo_id FROM face_tags WHERE person_id=$1`,
        [personId]
      );
      await pool.query("DELETE FROM photo_people WHERE person_id=$1", [personId]);
      await pool.query("DELETE FROM face_tags WHERE person_id=$1", [personId]);
      await pool.query("DELETE FROM people WHERE id=$1 AND username=$2", [personId, username]);
      for (const row of allPhotos.rows) await reEmbedPhoto(row.photo_id, username);
    }
    return NextResponse.json({ message: "Tag removed" });
  } catch (err) {
    console.error("DELETE /api/people error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}