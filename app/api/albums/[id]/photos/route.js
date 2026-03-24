import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

export async function POST(req, { params }) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const { photoIds } = await req.json();

    for (const photoId of photoIds) {
      await pool.query(
        "INSERT INTO album_photos (album_id, photo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [id, photoId]
      );
    }

    return NextResponse.json({ message: "Photos added to album" });
  } catch (err) {
    console.error("Add to album error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const { photoIds } = await req.json();

    const placeholders = photoIds.map((_, i) => `$${i + 2}`).join(', ');
    await pool.query(
      `DELETE FROM album_photos WHERE album_id = $1 AND photo_id IN (${placeholders})`,
      [id, ...photoIds]
    );

    return NextResponse.json({ message: "Photos removed from album" });
  } catch (err) {
    console.error("Remove from album error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}