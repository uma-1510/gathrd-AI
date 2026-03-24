
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { embedText, toSqlVector } from "@/lib/hf";

const VALID_EMOTIONS = new Set([
  "happy", "sad", "surprised", "angry", "fearful",
  "disgusted", "neutral", "excited", "calm",
]);

// Rebuild description snippet for the emotion part only — preserves the
// BLIP caption already in the description and just updates the emotion line.
function updateEmotionInDescription(existingDesc, faceCount, emotion) {
  if (!existingDesc) return existingDesc;

  // Remove any previous face/emotion sentence
  let desc = existingDesc
    .replace(/\bOne person visible[^.]*\./g, "")
    .replace(/\b\d+ people visible[^.]*\./g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (faceCount > 0) {
    const emotionText = emotion && emotion !== "neutral" ? `, appearing ${emotion}` : "";
    const faceSentence = `${faceCount === 1 ? "One person" : `${faceCount} people`} visible${emotionText}.`;
    desc = `${desc} ${faceSentence}`.trim();
  }

  return desc;
}

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

      const faceCountSafe =
        typeof faceCount === "number" && faceCount >= 0 ? faceCount : 0;

      const emotionSafe =
        dominantEmotion && VALID_EMOTIONS.has(dominantEmotion)
          ? dominantEmotion
          : null;

      // Fetch current photo to check if emotion actually changed
      const current = await pool.query(
        "SELECT dominant_emotion, ai_description, face_count FROM photos WHERE id = $1 AND uploaded_by = $2",
        [photoId, username]
      );

      if (!current.rows.length) continue;

      const row = current.rows[0];
      const emotionChanged = row.dominant_emotion !== emotionSafe;
      const faceCountChanged = row.face_count !== faceCountSafe;

      // Update face_count and dominant_emotion
      const r = await pool.query(
        `UPDATE photos
         SET face_count = $1, dominant_emotion = $2
         WHERE id = $3 AND uploaded_by = $4`,
        [faceCountSafe, emotionSafe, photoId, username]
      );
      updated += r.rowCount ?? 0;

      // If emotion or face count changed AND there's an existing description,
      // rebuild the description and re-embed so vector search reflects the new emotion.
      if ((emotionChanged || faceCountChanged) && row.ai_description) {
        const newDesc = updateEmotionInDescription(
          row.ai_description,
          faceCountSafe,
          emotionSafe
        );

        try {
          const embedding = await embedText(newDesc);
          await pool.query(
            "UPDATE photos SET ai_description = $1, embedding = $2::vector WHERE id = $3",
            [newDesc, toSqlVector(embedding), photoId]
          );
        } catch (embErr) {
          console.error(`Re-embed failed for photo ${photoId}:`, embErr.message);
          // Still save the updated description even if embedding fails
          await pool.query(
            "UPDATE photos SET ai_description = $1 WHERE id = $2",
            [newDesc, photoId]
          );
        }
      }
    }

    return NextResponse.json({ updated });
  } catch (err) {
    console.error("Analyze route error:", err);
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    );
  }
}