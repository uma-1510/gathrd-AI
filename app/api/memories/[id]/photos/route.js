// app/api/memories/[id]/photos/route.js
// GET /api/memories/[id]/photos
// Returns the full photo rows for all photo_ids stored in a memory.
// Only accessible by the memory's owner.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import supabaseAdmin from "@/lib/supabaseAdmin";

export async function GET(req, { params }) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const username = session.user.username;

    // Verify this memory belongs to the user and get its photo_ids
    const memRes = await pool.query(
      "SELECT photo_ids FROM memories WHERE id = $1 AND username = $2",
      [id, username]
    );

    if (!memRes.rows.length) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    const photoIds = memRes.rows[0].photo_ids;
    if (!photoIds || !photoIds.length) {
      return NextResponse.json({ photos: [] });
    }

    // Fetch full photo rows for those ids (only user's own photos — safe)
    const photosRes = await pool.query(
      `SELECT * FROM photos
       WHERE id = ANY($1::int[])
         AND uploaded_by = $2
       ORDER BY COALESCE(date_taken, uploaded_at) ASC`,
      [photoIds, username]
    );

    const ONE_YEAR = 60 * 60 * 24 * 365;

    // Refresh signed URLs (same pattern as /api/photos)
    const photos = await Promise.all(
      photosRes.rows.map(async (photo) => {
        if (!photo.storage_path) return photo;
        try {
          const { data, error } = await supabaseAdmin.storage
            .from("photos")
            .createSignedUrl(photo.storage_path, ONE_YEAR);
          if (error || !data?.signedUrl) return photo;
          return { ...photo, url: data.signedUrl };
        } catch {
          return photo;
        }
      })
    );

    return NextResponse.json({ photos });
  } catch (err) {
    console.error("Memory photos fetch error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}