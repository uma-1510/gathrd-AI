import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";

function getUserId(session) {
  return (
    session?.user?.username ||
    session?.user?.email ||
    session?.user?.name ||
    session?.user?.id ||
    null
  );
}

export async function POST(req) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await initDb();

    const body = await req.json();
    const { storage_path } = body;

    if (!storage_path) {
      return NextResponse.json(
        { error: "storage_path is required" },
        { status: 400 }
      );
    }

    const userId = getUserId(session);

    const result = await pool.query(
      `
      INSERT INTO videos (
        user_id,
        storage_path,
        uploaded_at
      )
      VALUES ($1, $2, NOW())
      RETURNING *
      `,
      [userId, storage_path]
    );

    return NextResponse.json({
      message: "Video metadata saved successfully",
      video: result.rows[0],
    });
  } catch (err) {
    console.error("SAVE VIDEO ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}