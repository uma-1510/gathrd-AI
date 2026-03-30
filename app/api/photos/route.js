import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";
import getSupabaseAdmin from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await initDb();

    // Fetch all photo rows for this user
    const result = await pool.query(
      `SELECT * FROM photos WHERE uploaded_by = $1 ORDER BY uploaded_at DESC`,
      [session.user.username]
    );

    const photos = result.rows;

    // Regenerate fresh signed URLs for any photo that has a storage_path.
    // This fixes the "photos disappear on refresh" bug caused by stale signed URLs.
    // Each URL is valid for 1 year from now.
    const ONE_YEAR = 60 * 60 * 24 * 365;

    const refreshed = await Promise.all(
      photos.map(async (photo) => {
        if (!photo.storage_path) return photo; // no path stored, return as-is

        try {
          const { data, error } = await getSupabaseAdmin.storage
            .from("photos")
            .createSignedUrl(photo.storage_path, ONE_YEAR);

          if (error || !data?.signedUrl) return photo; // fallback to stored URL

          // Update the stored URL in DB so future loads are faster
          // (fire and forget — don't await so we don't slow the response)
          pool.query(
            "UPDATE photos SET url = $1 WHERE id = $2",
            [data.signedUrl, photo.id]
          ).catch((err) => console.error("URL refresh DB update failed:", err));

          return { ...photo, url: data.signedUrl };
        } catch {
          return photo; // if refresh fails, return original
        }
      })
    );

    return NextResponse.json({ photos: refreshed });
  } catch (err) {
    console.error("Fetch photos error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}