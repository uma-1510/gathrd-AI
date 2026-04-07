// app/api/photos/caption/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

const PLATFORM_PROMPTS = {
  instagram: "Write an engaging Instagram caption. Conversational tone, 2-3 sentences, relevant emojis, 5-8 hashtags at the end.",
  linkedin:  "Write a professional LinkedIn caption. Thoughtful tone, 2-3 sentences, no hashtags, focus on the story or insight.",
  twitter:   "Write a Twitter/X post. Under 280 characters. Punchy and direct. 1-2 hashtags max.",
  threads:   "Write a Threads post. Casual and authentic, 1-2 sentences, minimal hashtags.",
};

export async function POST(req) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { photoId, platform = 'instagram' } = await req.json();
  const username = session.user.username;

  // Fetch photo with people
  const res = await pool.query(
    `SELECT p.ai_description, p.dominant_emotion, p.place_name,
            p.date_taken, p.face_count,
            ARRAY_AGG(per.name) FILTER (WHERE per.name IS NOT NULL) AS people
     FROM photos p
     LEFT JOIN photo_people pp ON pp.photo_id = p.id
     LEFT JOIN people per ON per.id = pp.person_id AND per.username = $1
     WHERE p.id = $2 AND p.uploaded_by = $1
     GROUP BY p.id`,
    [username, photoId]
  );

  if (!res.rows.length) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const photo = res.rows[0];
  const platformPrompt = PLATFORM_PROMPTS[platform] || PLATFORM_PROMPTS.instagram;

  const context = [
    photo.ai_description && `Photo description: ${photo.ai_description}`,
    photo.dominant_emotion && `Mood: ${photo.dominant_emotion}`,
    photo.place_name && `Location: ${photo.place_name}`,
    photo.date_taken && `Date: ${new Date(photo.date_taken).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
    photo.people?.filter(Boolean).length > 0 && `People: ${photo.people.filter(Boolean).join(', ')}`,
  ].filter(Boolean).join('\n');

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You write social media captions for photos. ${platformPrompt} Only return the caption text, nothing else.`,
        },
        {
          role: "user",
          content: context || "A photo with no metadata available.",
        },
      ],
    }),
  });

  const data = await response.json();
  const caption = data.choices?.[0]?.message?.content?.trim();

  return NextResponse.json({ caption: caption || "Could not generate caption." });
}