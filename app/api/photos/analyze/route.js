import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

/**
 * POST /api/photos/analyze
 *
 * Called by the gallery page after face-api.js finishes client-side detection.
 * Saves face_count and dominant_emotion for each uploaded photo.
 *
 * Body: {
 *   results: [
 *     { photoId: number, faceCount: number, dominantEmotion: string | null }
 *   ]
 * }
 */
export async function POST(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { results } = body;

    if (!Array.isArray(results) || results.length === 0) {
      return NextResponse.json({ error: "results array required" }, { status: 400 });
    }

    const username = session.user.username;
    let updated = 0;

    for (const { photoId, faceCount, dominantEmotion } of results) {
      if (typeof photoId !== "number") continue;

      const faceCountSafe = typeof faceCount === "number" && faceCount >= 0 ? faceCount : 0;

      // Validate emotion value — reject arbitrary strings
      const VALID_EMOTIONS = new Set([
        "happy", "sad", "surprised", "angry", "fearful",
        "disgusted", "neutral", "excited", "calm",
      ]);
      const emotionSafe =
        dominantEmotion && VALID_EMOTIONS.has(dominantEmotion)
          ? dominantEmotion
          : null;

      // Only update the user's own photos
      const r = await pool.query(
        `UPDATE photos
         SET face_count = $1, dominant_emotion = $2
         WHERE id = $3 AND uploaded_by = $4`,
        [faceCountSafe, emotionSafe, photoId, username]
      );
      updated += r.rowCount ?? 0;
    }

    return NextResponse.json({ updated });
  } catch (err) {
    console.error("Analyze route error:", err);
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}