import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

export async function PATCH(req, { params }) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    // Only allow the owner to pin/unpin
    const result = await pool.query(`
      UPDATE albums
      SET pinned = NOT pinned
      WHERE id = $1 AND created_by = $2
      RETURNING id, name, pinned
    `, [id, session.user.username]);

    if (!result.rows.length) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    return NextResponse.json({ album: result.rows[0] });
  } catch (err) {
    console.error("Pin album error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}