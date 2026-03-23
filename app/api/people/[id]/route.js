// app/api/people/[id]/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

// PATCH /api/people/[id] — rename person
export async function PATCH(req, { params }) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const { name } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

    await pool.query(
      "UPDATE people SET name = $1 WHERE id = $2 AND username = $3",
      [name.trim(), id, session.user.username]
    );

    return NextResponse.json({ message: "Updated" });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/people/[id]
export async function DELETE(req, { params }) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    await pool.query(
      "DELETE FROM people WHERE id = $1 AND username = $2",
      [id, session.user.username]
    );

    return NextResponse.json({ message: "Deleted" });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/people/[id]/photos — get all photos for a person
export async function GET(req, { params }) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const result = await pool.query(
      `SELECT photos.* FROM photos
       JOIN photo_people ON photo_people.photo_id = photos.id
       WHERE photo_people.person_id = $1
         AND photos.uploaded_by = $2
       ORDER BY photos.uploaded_at DESC`,
      [id, session.user.username]
    );

    return NextResponse.json({ photos: result.rows });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}