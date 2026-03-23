import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { embedText, toSqlVector } from "@/lib/hf";

// POST /api/photos/tag
// Body: { photoId, personId, descriptor? }
// Tags a person in a photo. Also re-embeds the photo description
// with the person's name included, so search works.
export async function POST(req) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { photoId, personId, descriptor } = await req.json();
  if (!photoId || !personId)
    return NextResponse.json({ error: "photoId and personId required" }, { status: 400 });

  // Verify photo belongs to user
  const photoCheck = await pool.query(
    "SELECT * FROM photos WHERE id = $1 AND uploaded_by = $2",
    [photoId, session.user.username]
  );
  if (!photoCheck.rows.length)
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  // Verify person belongs to user
  const personCheck = await pool.query(
    "SELECT * FROM people WHERE id = $1 AND username = $2",
    [personId, session.user.username]
  );
  if (!personCheck.rows.length)
    return NextResponse.json({ error: "Person not found" }, { status: 404 });

  const person = personCheck.rows[0];
  const photo  = photoCheck.rows[0];

  // Insert face tag
  await pool.query(
    `INSERT INTO face_tags (photo_id, person_id, descriptor)
     VALUES ($1, $2, $3)
     ON CONFLICT (photo_id, person_id) DO NOTHING`,
    [photoId, personId, descriptor ? JSON.stringify(descriptor) : null]
  );

  // Set cover photo for person if they don't have one
  await pool.query(
    `UPDATE people SET cover_photo_id = $1
     WHERE id = $2 AND cover_photo_id IS NULL`,
    [photoId, personId]
  );

  // Re-embed this photo with person's name in the description
  // Get all people tagged in this photo
  const taggedPeople = await pool.query(`
    SELECT p.name FROM people p
    JOIN face_tags ft ON ft.person_id = p.id
    WHERE ft.photo_id = $1
  `, [photoId]);

  const personNames = taggedPeople.rows.map(r => r.name);
  const currentDesc = photo.ai_description ?? "";

  // Build new description: add person names if not already there
  const namePhrase   = `People in this photo: ${personNames.join(", ")}.`;
  let newDesc = currentDesc.replace(/People in this photo:[^.]+\./g, "").trim();
  newDesc = (newDesc + " " + namePhrase).trim();

  // Re-embed
  try {
    const vec = await embedText(newDesc);
    await pool.query(
      "UPDATE photos SET ai_description = $1, embedding = $2::vector WHERE id = $3",
      [newDesc, toSqlVector(vec), photoId]
    );
  } catch (err) {
    console.error("Re-embed after tag failed:", err.message);
    // Update description even if embedding fails
    await pool.query(
      "UPDATE photos SET ai_description = $1 WHERE id = $2",
      [newDesc, photoId]
    );
  }

  return NextResponse.json({ message: "Tagged", personName: person.name });
}

// DELETE /api/photos/tag
// Body: { photoId, personId }
export async function DELETE(req) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { photoId, personId } = await req.json();

  await pool.query(
    "DELETE FROM face_tags WHERE photo_id = $1 AND person_id = $2",
    [photoId, personId]
  );

  // Re-embed with updated person list
  const taggedPeople = await pool.query(`
    SELECT p.name FROM people p
    JOIN face_tags ft ON ft.person_id = p.id
    WHERE ft.photo_id = $1
  `, [photoId]);

  const photo = await pool.query("SELECT * FROM photos WHERE id = $1", [photoId]);
  if (photo.rows.length) {
    const personNames = taggedPeople.rows.map(r => r.name);
    let desc = photo.rows[0].ai_description ?? "";
    desc = desc.replace(/People in this photo:[^.]+\./g, "").trim();

    if (personNames.length > 0) {
      desc = (desc + ` People in this photo: ${personNames.join(", ")}.`).trim();
    }

    try {
      const vec = await embedText(desc);
      await pool.query(
        "UPDATE photos SET ai_description = $1, embedding = $2::vector WHERE id = $3",
        [desc, toSqlVector(vec), photoId]
      );
    } catch {
      await pool.query("UPDATE photos SET ai_description = $1 WHERE id = $2", [desc, photoId]);
    }
  }

  return NextResponse.json({ message: "Tag removed" });
}