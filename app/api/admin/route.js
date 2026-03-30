export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";

export async function GET() {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await initDb();

    const usersResult = await pool.query(`
      SELECT 
        users.id,
        users.username,
        users.email,
        users.role,
        users.created_at,
        COUNT(photos.id) AS photo_count
      FROM users
      LEFT JOIN photos ON photos.uploaded_by = users.username
      GROUP BY users.id
      ORDER BY users.created_at DESC
    `);

    const statsResult = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(*) FROM photos) AS total_photos,
        (SELECT COUNT(*) FROM albums) AS total_albums
    `);

    return NextResponse.json({
      users: usersResult.rows,
      stats: statsResult.rows[0],
    });
  } catch (err) {
    console.error("Admin fetch error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}