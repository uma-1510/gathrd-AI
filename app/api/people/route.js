// app/api/people/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { euclidean } from "@/lib/faceMatcher";

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

// POST /api/people — create or OVERWRITE a named person for a cluster
// If the cluster was previously tagged with a different name, the old record
// is fully replaced: old photo_people + face_tags rows are deleted and
// rewritten under the new name.
// Body: { name, faceDescriptor, coverPhotoUrl?, photoIds?, oldPersonId? }
export async function POST(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { name, faceDescriptor, coverPhotoUrl, photoIds, oldPersonId } = await req.json();

    if (!name?.trim())
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    if (!Array.isArray(faceDescriptor) || faceDescriptor.length === 0)
      return NextResponse.json({ error: "faceDescriptor required" }, { status: 400 });

    const username = session.user.username;

    // ── Step 1: If there was a previous tag on this cluster, delete it cleanly
    // This handles the "re-tag" case: user tagged a cluster as "John", now
    // wants to rename/replace to "Pooja". We wipe John's photo links for
    // this cluster's photos and remove John's record if it has no photos left.
    if (oldPersonId) {
      // Remove photo links for this cluster's photos from the old person
      if (photoIds?.length) {
        await pool.query(
          `DELETE FROM photo_people WHERE person_id = $1 AND photo_id = ANY($2)`,
          [oldPersonId, photoIds]
        );
        await pool.query(
          `DELETE FROM face_tags WHERE person_id = $1 AND photo_id = ANY($2)`,
          [oldPersonId, photoIds]
        );
      }

      // If the old person now has zero photos linked, delete the person record too
      const remaining = await pool.query(
        `SELECT COUNT(*) FROM (
           SELECT photo_id FROM photo_people WHERE person_id = $1
           UNION
           SELECT photo_id FROM face_tags WHERE person_id = $1
         ) t`,
        [oldPersonId]
      );
      if (parseInt(remaining.rows[0].count, 10) === 0) {
        await pool.query(
          `DELETE FROM people WHERE id = $1 AND username = $2`,
          [oldPersonId, username]
        );
      }
    }

    // ── Step 2: Upsert the person record under the new name
    // ON CONFLICT (username, name) means if "Pooja" already exists, we just
    // update the face_descriptor — merging this cluster into the existing person.
    const result = await pool.query(
      `INSERT INTO people (username, name, face_descriptor, cover_photo_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username, name)
       DO UPDATE SET
         face_descriptor  = $3,
         cover_photo_url  = COALESCE($4, people.cover_photo_url)
       RETURNING *`,
      [username, name.trim(), faceDescriptor, coverPhotoUrl || null]
    );

    const person = result.rows[0];

    // ── Step 3: Link this cluster's explicit photos
    if (photoIds?.length) {
      for (const photoId of photoIds) {
        await pool.query(
          `INSERT INTO photo_people (photo_id, person_id, confidence)
           VALUES ($1, $2, 1.0)
           ON CONFLICT DO NOTHING`,
          [photoId, person.id]
        );
      }
    }

    // ── Step 4: Backfill — auto-link any other photos whose stored face
    // descriptors match the new centroid, so future uploads and missed
    // photos are all attributed to the correct person.
    try {
      const MATCH_THRESHOLD = 0.6;
      const photosRes = await pool.query(
        `SELECT id, face_descriptors FROM photos
         WHERE uploaded_by = $1 AND face_descriptors IS NOT NULL`,
        [username]
      );

      const backfillIds = [];
      for (const photo of photosRes.rows) {
        let descriptors = photo.face_descriptors;
        if (typeof descriptors === "string") {
          try { descriptors = JSON.parse(descriptors); } catch { continue; }
        }
        if (!Array.isArray(descriptors) || descriptors.length === 0) continue;

        const isMatch = descriptors.some(
          (d) => Array.isArray(d) && euclidean(d, faceDescriptor) < MATCH_THRESHOLD
        );
        if (isMatch) backfillIds.push(photo.id);
      }

      for (const photoId of backfillIds) {
        await pool.query(
          `INSERT INTO photo_people (photo_id, person_id, confidence)
           VALUES ($1, $2, 0.85)
           ON CONFLICT DO NOTHING`,
          [photoId, person.id]
        );
      }

      console.log(`[people POST] Backfilled ${backfillIds.length} photos for "${name}"`);
    } catch (backfillErr) {
      console.error("[people POST] Backfill error (non-fatal):", backfillErr.message);
    }

    return NextResponse.json({ person }, { status: 201 });
  } catch (err) {
    console.error("POST /api/people error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/people — delete a person and ALL their photo links
// Body: { personId }
export async function DELETE(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { personId } = await req.json();
    if (!personId) return NextResponse.json({ error: "personId required" }, { status: 400 });

    const username = session.user.username;

    // Verify ownership before deleting
    const check = await pool.query(
      `SELECT id FROM people WHERE id = $1 AND username = $2`,
      [personId, username]
    );
    if (!check.rows.length)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Cascade delete photo links, then the person record
    await pool.query(`DELETE FROM photo_people WHERE person_id = $1`, [personId]);
    await pool.query(`DELETE FROM face_tags   WHERE person_id = $1`, [personId]);
    await pool.query(`DELETE FROM people      WHERE id = $1 AND username = $2`, [personId, username]);

    return NextResponse.json({ message: "Deleted" });
  } catch (err) {
    console.error("DELETE /api/people error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}