// app/api/home/route.js
// Single endpoint for the home dashboard.
// Returns: memories, pinnedAlbums, recentAlbums, stats
// Lazily generates missing monthly memories on first call.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";
import { initMemories } from "@/lib/initMemories";
import { generateMemoriesForUser } from "@/lib/generateMemories";

export async function GET() {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const username = session.user.username;

    await initDb();
    await initMemories();

    // ── Lazily generate any missing monthly memories ──────────────────────
    // Fire-and-forget on subsequent loads if memories already exist,
    // but await on first load so the page has data immediately.
    const memCountRes = await pool.query(
      "SELECT COUNT(*) FROM memories WHERE username = $1",
      [username]
    );
    const memCount = parseInt(memCountRes.rows[0].count, 10);

    if (memCount === 0) {
      // First visit — generate synchronously so the page isn't empty
      await generateMemoriesForUser(username);
    } else {
      // Subsequent visits — regenerate in background for any new months
      generateMemoriesForUser(username).catch(err =>
        console.error("Background memory generation failed:", err)
      );
    }

    // ── Fetch memories (most recent first, max 12) ────────────────────────
    const memoriesRes = await pool.query(`
      SELECT id, title, subtitle, date_label, period_start, period_end,
             cover_url, photo_count, dominant_mood, generated_at
      FROM memories
      WHERE username = $1
      ORDER BY period_start DESC
      LIMIT 12
    `, [username]);

    // ── Fetch pinned albums ───────────────────────────────────────────────
    const pinnedRes = await pool.query(`
      SELECT
        albums.id,
        albums.name,
        albums.description,
        albums.pinned,
        albums.created_at,
        COUNT(DISTINCT album_photos.photo_id) AS photo_count,
        (
          SELECT photos.url FROM photos
          JOIN album_photos ap ON ap.photo_id = photos.id
          WHERE ap.album_id = albums.id
          ORDER BY ap.added_at ASC LIMIT 1
        ) AS cover_url
      FROM albums
      LEFT JOIN album_photos ON album_photos.album_id = albums.id
      WHERE albums.created_by = $1 AND albums.pinned = true
      GROUP BY albums.id
      ORDER BY albums.created_at DESC
    `, [username]);

    // ── Fetch 6 most recently updated albums (pinned or not) ─────────────
    const recentAlbumsRes = await pool.query(`
      SELECT
        albums.id,
        albums.name,
        albums.description,
        albums.pinned,
        albums.created_at,
        COUNT(DISTINCT album_photos.photo_id) AS photo_count,
        MAX(album_photos.added_at) AS last_added,
        (
          SELECT photos.url FROM photos
          JOIN album_photos ap ON ap.photo_id = photos.id
          WHERE ap.album_id = albums.id
          ORDER BY ap.added_at DESC LIMIT 1
        ) AS cover_url
      FROM albums
      LEFT JOIN album_photos ON album_photos.album_id = albums.id
      WHERE albums.created_by = $1
      GROUP BY albums.id
      ORDER BY COALESCE(MAX(album_photos.added_at), albums.created_at) DESC
      LIMIT 6
    `, [username]);

    // ── Quick stats ───────────────────────────────────────────────────────
    const statsRes = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM photos WHERE uploaded_by = $1) AS total_photos,
        (SELECT COUNT(*) FROM albums WHERE created_by = $1) AS total_albums,
        (SELECT COUNT(*) FROM memories WHERE username = $1) AS total_memories,
        (SELECT COUNT(*) FROM photos
         WHERE uploaded_by = $1
           AND uploaded_at >= NOW() - INTERVAL '30 days') AS photos_this_month
    `, [username]);

    return NextResponse.json({
      memories:     memoriesRes.rows,
      pinnedAlbums: pinnedRes.rows,
      recentAlbums: recentAlbumsRes.rows,
      stats:        statsRes.rows[0],
    });
  } catch (err) {
    console.error("Home API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}