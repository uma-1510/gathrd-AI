// app/api/memories/[id]/photos/route.js
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

    const memRes = await pool.query(
      "SELECT photo_ids, period_start, period_end FROM memories WHERE id = $1 AND username = $2",
      [id, username]
    );

    if (!memRes.rows.length) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    const { photo_ids: photoIds, period_start, period_end } = memRes.rows[0];

    let photosRes;

    if (photoIds && photoIds.length) {
      // Use stored photo_ids if available
      photosRes = await pool.query(
        `SELECT * FROM photos
         WHERE id = ANY($1::int[]) AND uploaded_by = $2
         ORDER BY COALESCE(date_taken, uploaded_at) ASC`,
        [photoIds, username]
      );
    } else {
      // Fallback: fetch photos by date range from the memory period
      photosRes = await pool.query(
        `SELECT * FROM photos
         WHERE uploaded_by = $1
           AND COALESCE(date_taken, uploaded_at) >= $2
           AND COALESCE(date_taken, uploaded_at) <= $3
         ORDER BY COALESCE(date_taken, uploaded_at) ASC`,
        [username, period_start, period_end]
      );
    }

    const ONE_YEAR = 60 * 60 * 24 * 365;

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