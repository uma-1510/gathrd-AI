import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";
import supabaseAdmin from "@/lib/supabaseAdmin";

function getPossibleOwners(session) {
  return [
    session?.user?.username,
    session?.user?.email,
    session?.user?.name,
    session?.user?.id,
  ]
    .filter(Boolean)
    .map((v) => String(v));
}

function rowMatchesOwner(video, owners) {
  const candidates = [video.user_id]
    .filter(Boolean)
    .map((v) => String(v));

  return owners.some((owner) => candidates.includes(owner));
}

function isValidStoragePath(value) {
  if (!value || typeof value !== "string") return false;
  if (value.startsWith("http://") || value.startsWith("https://")) return false;
  if (value.includes("undefined") || value.includes("null")) return false;
  return true;
}

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await initDb();

    const possibleOwners = getPossibleOwners(session);

    const result = await pool.query(
      `
      SELECT *
      FROM videos
      ORDER BY uploaded_at DESC
      `
    );

    const ownedVideos = result.rows.filter((video) =>
      rowMatchesOwner(video, possibleOwners)
    );

    const videosWithUrls = await Promise.all(
      ownedVideos.map(async (video) => {
        if (!isValidStoragePath(video.storage_path)) {
          return { ...video, url: null, media_type: "video" };
        }

        try {
          const { data, error } = await supabaseAdmin.storage
            .from("videos")
            .createSignedUrl(video.storage_path, 60 * 60 * 24 * 30);

          if (error || !data?.signedUrl) {
            return { ...video, url: null, media_type: "video" };
          }

          return {
            ...video,
            url: data.signedUrl,
            media_type: "video",
          };
        } catch {
          return { ...video, url: null, media_type: "video" };
        }
      })
    );

    return NextResponse.json({ videos: videosWithUrls });
  } catch (err) {
    console.error("GET VIDEOS ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}