import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";

const ALLOWED_MOODS = new Set(["upbeat", "cinematic", "emotional"]);

export async function POST(req) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await initDb();

    const body = await req.json().catch(() => ({}));
    const requestedMood = String(body?.mood || "").toLowerCase().trim();
    const mood = ALLOWED_MOODS.has(requestedMood) ? requestedMood : "cinematic";

    let result = await pool.query(
      `
      SELECT *
      FROM music_tracks
      WHERE LOWER(mood) = $1
      ORDER BY RANDOM()
      LIMIT 1
      `,
      [mood]
    );

    if (result.rows.length === 0) {
      result = await pool.query(
        `
        SELECT *
        FROM music_tracks
        ORDER BY RANDOM()
        LIMIT 1
        `
      );
    }

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "No music tracks found in music_tracks table" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: "Music track selected successfully",
      track: result.rows[0],
    });
  } catch (err) {
    console.error("MUSIC PICK ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}