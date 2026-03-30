// app/api/people/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { embedText, toSqlVector } from "@/lib/hf";
import { updateDescriptionWithPeople } from "@/lib/description";

// ── Shared helper: re-embed a photo after its people tags change ─────────────
async function reEmbedPhoto(photoId, username) {
  try {
    const photo = await pool.query(
      "SELECT ai_description FROM photos WHERE id = $1 AND uploaded_by = $2",
      [photoId, username]
    );
    if (!photo.rows.length) return;

    const taggedPeople = await pool.query(
      `SELECT DISTINCT per.name FROM people per WHERE per.username = $1
         AND (
           EXISTS (SELECT 1 FROM photo_people pp WHERE pp.photo_id = $2 AND pp.person_id = per.id)
           OR
           EXISTS (SELECT 1 FROM face_tags   ft WHERE ft.photo_id = $2 AND ft.person_id = per.id)
         )`,
      [username, photoId]
    );

    const personNames = taggedPeople.rows.map(r => r.name);
    const newDesc = updateDescriptionWithPeople(photo.rows[0].ai_description, personNames);

    try {
      const vec = await embedText(newDesc);
      await pool.query(
        "UPDATE photos SET ai_description = $1, embedding = $2::vector WHERE id = $3",
        [newDesc, toSqlVector(vec), photoId]
      );
    } catch (embedErr) {
      console.error(`Re-embed failed for photo ${photoId}:`, embedErr.message);
      await pool.query(
        "UPDATE photos SET ai_description = $1 WHERE id = $2",
        [newDesc, photoId]
      );
    }
  } catch (err) {
    console.error(`reEmbedPhoto error for photo ${photoId}:`, err.message);
  }
}

// GET /api/people — list all named people for this user
export async function GET() {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await pool.query(
      `SELECT p.id, p.name, p.cover_photo_url, p.created_at,
              COUNT(pp.photo_id)::int AS photo_count
       FROM people p
       LEFT JOIN (
         SELECT person_id, photo_id FROM photo_people
         UNION
         SELECT person_id, photo_id FROM face_tags
       ) pp ON pp.person_id = p.id
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

// POST /api/people — create or update a named person, overwriting any previous
//                    tag on the same photos (no duplicate tagging)
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

    // Upsert person (update descriptor + cover if name already exists)
    const result = await pool.query(
      `INSERT INTO people (username, name, face_descriptor, cover_photo_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username, name)
       DO UPDATE SET face_descriptor = $3, cover_photo_url = COALESCE($4, people.cover_photo_url)
       RETURNING *`,
      [username, name.trim(), faceDescriptor, coverPhotoUrl || null]
    );

    const person = result.rows[0];

    if (photoIds?.length) {
      for (const photoId of photoIds) {
        // Remove any existing tag on this photo first (prevents duplicates,
        // and allows re-tagging the same photo with a different name)
        await pool.query("DELETE FROM photo_people WHERE photo_id = $1", [photoId]);
        await pool.query("DELETE FROM face_tags WHERE photo_id = $1", [photoId]);

        // Insert the new tag
        await pool.query(
          `INSERT INTO photo_people (photo_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [photoId, person.id]
        );

        // Re-embed with the updated person name
        await reEmbedPhoto(photoId, username);
      }
    }

    return NextResponse.json({ person }, { status: 201 });
  } catch (err) {
    console.error("POST /api/people error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/people — un-tag a person from specific photos, or fully delete them
// Body: { personId: number, photoIds?: number[] }
//   - with photoIds → removes tag only from those photos, re-embeds them
//   - without photoIds → removes from all photos and deletes the person record
export async function DELETE(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { personId, photoIds } = await req.json();
    if (!personId) return NextResponse.json({ error: "personId required" }, { status: 400 });

    const username = session.user.username;

    // Verify this person belongs to the session user
    const personCheck = await pool.query(
      "SELECT id FROM people WHERE id = $1 AND username = $2",
      [personId, username]
    );
    if (!personCheck.rows.length) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    if (photoIds?.length) {
      // Un-tag from specific photos only
      for (const photoId of photoIds) {
        await pool.query(
          "DELETE FROM photo_people WHERE photo_id = $1 AND person_id = $2",
          [photoId, personId]
        );
        await pool.query(
          "DELETE FROM face_tags WHERE photo_id = $1 AND person_id = $2",
          [photoId, personId]
        );
        await reEmbedPhoto(photoId, username);
      }
    } else {
      // No photoIds → delete person from all photos and remove the record entirely
      const allPhotos = await pool.query(
        `SELECT DISTINCT photo_id FROM photo_people WHERE person_id = $1
         UNION
         SELECT DISTINCT photo_id FROM face_tags WHERE person_id = $1`,
        [personId]
      );

      await pool.query("DELETE FROM photo_people WHERE person_id = $1", [personId]);
      await pool.query("DELETE FROM face_tags WHERE person_id = $1", [personId]);
      await pool.query("DELETE FROM people WHERE id = $1 AND username = $2", [personId, username]);

      for (const row of allPhotos.rows) {
        await reEmbedPhoto(row.photo_id, username);
      }
    }

    return NextResponse.json({ message: "Tag removed" });
  } catch (err) {
    console.error("DELETE /api/people error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}