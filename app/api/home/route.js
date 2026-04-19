// app/api/home/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";
import { initMemories } from "@/lib/initMemories";
import { generateMemoriesForUser } from "@/lib/generateMemories";
import supabaseAdmin from "@/lib/supabaseAdmin";

const ONE_YEAR = 60 * 60 * 24 * 365;

// FIX: refresh a signed URL from storage_path — never use stored signed URLs
async function refreshPhotoUrl(photo) {
  if (!photo) return null;
  // If photo has a storage_path, get a fresh signed URL
  if (photo.storage_path) {
    try {
      const { data, error } = await supabaseAdmin.storage
        .from("photos")
        .createSignedUrl(photo.storage_path, ONE_YEAR);
      if (!error && data?.signedUrl) {
        // Update the stored URL in background so it's fresh next time
        pool.query("UPDATE photos SET url = $1 WHERE id = $2", [data.signedUrl, photo.id])
          .catch(() => {});
        return data.signedUrl;
      }
    } catch {}
  }
  // Fall back to stored URL
  return photo.url || null;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const username = session.user.username;

    await initDb();
    await initMemories();

    const memCountRes = await pool.query(
      "SELECT COUNT(*) FROM memories WHERE username = $1",
      [username]
    );
    const memCount = parseInt(memCountRes.rows[0].count, 10);

    if (memCount === 0) {
      await generateMemoriesForUser(username);
    } else {
      generateMemoriesForUser(username).catch(err =>
        console.error("Background memory generation failed:", err)
      );
    }

    // ── Fetch memories with fresh cover URLs ─────────────────────────────
    const memoriesRes = await pool.query(`
      SELECT m.id, m.title, m.subtitle, m.date_label, m.period_start, m.period_end,
             m.photo_count, m.dominant_mood, m.generated_at,
             -- FIX: get fresh photo data instead of stored signed URL
             p.id AS cover_photo_id, p.url AS cover_url, p.storage_path AS cover_storage_path
      FROM memories m
      LEFT JOIN LATERAL (
        SELECT ph.id, ph.url, ph.storage_path
        FROM photos ph
        WHERE ph.uploaded_by = $1
          AND ph.uploaded_at >= m.period_start
          AND ph.uploaded_at <= m.period_end + INTERVAL '1 day'
        ORDER BY COALESCE(ph.date_taken, ph.uploaded_at) ASC
        LIMIT 1
      ) p ON true
      WHERE m.username = $1
      ORDER BY m.period_start DESC
      LIMIT 12
    `, [username]);

    // Refresh cover URLs for memories
    const memories = await Promise.all(
      memoriesRes.rows.map(async (memory) => {
        const freshUrl = await refreshPhotoUrl({
          id: memory.cover_photo_id,
          url: memory.cover_url,
          storage_path: memory.cover_storage_path,
        });
        return {
          id: memory.id,
          title: memory.title,
          subtitle: memory.subtitle,
          date_label: memory.date_label,
          period_start: memory.period_start,
          period_end: memory.period_end,
          photo_count: memory.photo_count,
          dominant_mood: memory.dominant_mood,
          generated_at: memory.generated_at,
          cover_url: freshUrl,
        };
      })
    );

    // ── Fetch pinned albums with fresh cover URLs ─────────────────────────
    const pinnedRes = await pool.query(`
      SELECT
        albums.id, albums.name, albums.description, albums.pinned, albums.created_at,
        COUNT(DISTINCT album_photos.photo_id) AS photo_count,
        (
          SELECT row_to_json(ph) FROM (
            SELECT photos.id, photos.url, photos.storage_path
            FROM photos
            JOIN album_photos ap ON ap.photo_id = photos.id
            WHERE ap.album_id = albums.id
            ORDER BY ap.added_at ASC LIMIT 1
          ) ph
        ) AS cover_photo
      FROM albums
      LEFT JOIN album_photos ON album_photos.album_id = albums.id
      WHERE albums.created_by = $1 AND albums.pinned = true
      GROUP BY albums.id
      ORDER BY albums.created_at DESC
    `, [username]);

    const pinnedAlbums = await Promise.all(
      pinnedRes.rows.map(async (album) => {
        const freshUrl = await refreshPhotoUrl(album.cover_photo);
        const { cover_photo, ...rest } = album;
        return { ...rest, cover_url: freshUrl };
      })
    );

    // ── Fetch recent albums with fresh cover URLs ─────────────────────────
    const recentAlbumsRes = await pool.query(`
      SELECT
        albums.id, albums.name, albums.description, albums.pinned, albums.created_at,
        COUNT(DISTINCT album_photos.photo_id) AS photo_count,
        MAX(album_photos.added_at) AS last_added,
        (
          SELECT row_to_json(ph) FROM (
            SELECT photos.id, photos.url, photos.storage_path
            FROM photos
            JOIN album_photos ap ON ap.photo_id = photos.id
            WHERE ap.album_id = albums.id
            ORDER BY ap.added_at DESC LIMIT 1
          ) ph
        ) AS cover_photo
      FROM albums
      LEFT JOIN album_photos ON album_photos.album_id = albums.id
      WHERE albums.created_by = $1
      GROUP BY albums.id
      ORDER BY COALESCE(MAX(album_photos.added_at), albums.created_at) DESC
      LIMIT 6
    `, [username]);

    const recentAlbums = await Promise.all(
      recentAlbumsRes.rows.map(async (album) => {
        const freshUrl = await refreshPhotoUrl(album.cover_photo);
        const { cover_photo, ...rest } = album;
        return { ...rest, cover_url: freshUrl };
      })
    );

    // ── Stats ─────────────────────────────────────────────────────────────
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
      memories,
      pinnedAlbums,
      recentAlbums,
      stats: statsRes.rows[0],
    });
  } catch (err) {
    console.error("Home API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}