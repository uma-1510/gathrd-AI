// app/api/people/[id]/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

// PATCH — rename a person
export async function PATCH(req, { params }) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const personId = params.id;
    const { name } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });

    const username = session.user.username;

    const check = await pool.query(
      "SELECT id FROM people WHERE id=$1 AND username=$2",
      [personId, username]
    );
    if (!check.rows.length) return NextResponse.json({ error: "Person not found" }, { status: 404 });

    // Check for name collision
    const collision = await pool.query(
      "SELECT id FROM people WHERE username=$1 AND name ILIKE $2 AND id != $3",
      [username, name.trim(), personId]
    );
    if (collision.rows.length) {
      return NextResponse.json({ error: `A person named "${name.trim()}" already exists. Use the merge feature instead.` }, { status: 409 });
    }

    const result = await pool.query(
      "UPDATE people SET name=$1 WHERE id=$2 AND username=$3 RETURNING *",
      [name.trim(), personId, username]
    );

    return NextResponse.json({ person: result.rows[0] });
  } catch (err) {
    console.error("PATCH /api/people/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}