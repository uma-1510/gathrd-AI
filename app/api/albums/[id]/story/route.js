// app/api/albums/[id]/story/route.js
// Generates and caches an AI story summary for a shared album.
// Cached in albums.story_summary — regenerated only if photos change.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

export async function GET(req, { params }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const username = session.user.username;

  // Access check
  const albumRes = await pool.query(
    `SELECT a.*, a.story_summary FROM albums a
     WHERE a.id = $1 AND (
       a.created_by = $2
       OR EXISTS (SELECT 1 FROM album_members am WHERE am.album_id = a.id AND am.username = $2)
     )`,
    [id, username]
  );
  if (!albumRes.rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const album = albumRes.rows[0];

  // Return cached summary if exists
  if (album.story_summary) {
    return NextResponse.json({ summary: album.story_summary, cached: true });
  }

  // Build summary from album's photo data
  const statsRes = await pool.query(
    `SELECT
       COUNT(p.id) AS photo_count,
       COUNT(DISTINCT p.uploaded_by) AS contributor_count,
       COUNT(DISTINCT p.place_name) FILTER (WHERE p.place_name IS NOT NULL) AS location_count,
       MIN(COALESCE(p.date_taken, p.uploaded_at)) AS first_date,
       MAX(COALESCE(p.date_taken, p.uploaded_at)) AS last_date,
       ARRAY_AGG(DISTINCT p.place_name) FILTER (WHERE p.place_name IS NOT NULL) AS locations,
       ARRAY_AGG(DISTINCT p.uploaded_by) AS contributors,
       MODE() WITHIN GROUP (ORDER BY p.dominant_emotion) AS dominant_mood
     FROM album_photos ap
     JOIN photos p ON p.id = ap.photo_id
     WHERE ap.album_id = $1`,
    [id]
  );

  const stats = statsRes.rows[0];
  if (!stats.photo_count || stats.photo_count === '0') {
    return NextResponse.json({ summary: null });
  }

  const days = stats.first_date && stats.last_date
    ? Math.max(1, Math.round((new Date(stats.last_date) - new Date(stats.first_date)) / (1000 * 60 * 60 * 24)) + 1)
    : 1;

  const context = [
    `Album name: ${album.name}`,
    `${stats.photo_count} photos`,
    `${stats.contributor_count} people contributed`,
    `Spanning ${days} day${days !== 1 ? 's' : ''}`,
    stats.locations?.filter(Boolean).length > 0 && `Locations: ${stats.locations.filter(Boolean).slice(0, 3).join(', ')}`,
    stats.dominant_mood && `Overall mood: ${stats.dominant_mood}`,
    stats.contributors?.length > 0 && `Contributors: ${stats.contributors.join(', ')}`,
  ].filter(Boolean).join('\n');

  const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content: "Write a warm, 2-sentence story summary for a shared photo album. Write as if narrating a memory. No markdown, no lists. Just two natural sentences.",
        },
        { role: "user", content: context },
      ],
    }),
  });

  const aiData = await aiRes.json();
  const summary = aiData.choices?.[0]?.message?.content?.trim() || null;

  // Cache it — only needs to be generated once
  if (summary) {
    await pool.query(
      "UPDATE albums SET story_summary = $1 WHERE id = $2",
      [summary, id]
    );
  }

  // Build stats object for the card
  const storyCard = {
    summary,
    photo_count: parseInt(stats.photo_count),
    contributor_count: parseInt(stats.contributor_count),
    location_count: parseInt(stats.location_count),
    days,
    locations: stats.locations?.filter(Boolean).slice(0, 3) || [],
    dominant_mood: stats.dominant_mood,
  };

  return NextResponse.json(storyCard);
}