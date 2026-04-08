import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";
import supabaseAdmin from "@/lib/supabaseAdmin";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function getUserId(session) {
  return (
    session?.user?.username ||
    session?.user?.email ||
    session?.user?.name ||
    session?.user?.id ||
    null
  );
}

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

function rowMatchesOwner(row, owners) {
  const candidates = [
    row.user_id,
    row.uploaded_by,
    row.owner,
    row.username,
    row.email,
  ]
    .filter(Boolean)
    .map((v) => String(v));

  return owners.some((owner) => candidates.includes(owner));
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function downloadToFile(url, outputPath) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.writeFile(outputPath, buffer);
}

async function runFfmpeg(args) {
  try {
    const { stdout, stderr } = await execFileAsync("ffmpeg", args);
    return { stdout, stderr };
  } catch (err) {
    const stderr = err?.stderr || err?.message || "Unknown ffmpeg error";
    throw new Error(`FFmpeg failed: ${stderr}`);
  }
}

async function getSignedPhotoUrl(photo) {
  if (photo.storage_path) {
    const signed = await supabaseAdmin.storage
      .from("photos")
      .createSignedUrl(photo.storage_path, 60 * 60);

    if (!signed.error && signed.data?.signedUrl) {
      return signed.data.signedUrl;
    }
  }

  if (photo.url) return photo.url;

  throw new Error(`No valid URL for photo ${photo.id}`);
}

async function getSignedVideoUrl(video) {
  if (video.storage_path) {
    const signed = await supabaseAdmin.storage
      .from("videos")
      .createSignedUrl(video.storage_path, 60 * 60);

    if (!signed.error && signed.data?.signedUrl) {
      return signed.data.signedUrl;
    }
  }

  if (video.url) return video.url;

  throw new Error(`No valid URL for video ${video.id}`);
}

export async function POST(req) {
  const workDir = path.join(os.tmpdir(), "recaps", randomUUID());
  let recapId = null;

  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = getUserId(session);

    if (!userId) {
      return NextResponse.json({ error: "User identity missing" }, { status: 400 });
    }

    await initDb();
    await ensureDir(workDir);

    const body = await req.json();
const {
  event_date,
  photoIds = [],
  videoIds = [],
  musicTrackId,
  selectedMedia = [],
} = body;

    if ((!photoIds || photoIds.length === 0) && (!videoIds || videoIds.length === 0)) {
      return NextResponse.json(
        { error: "At least one photo or video is required" },
        { status: 400 }
      );
    }

    if (!musicTrackId) {
      return NextResponse.json({ error: "musicTrackId is required" }, { status: 400 });
    }

    const owners = getPossibleOwners(session);

    const recapInsert = await pool.query(
  `
  INSERT INTO recaps (
    user_id,
    event_date,
    storage_path,
    file_size,
    duration,
    thumbnail,
    updated_at
  )
  VALUES ($1, $2, $3, $4, $5, $6, NOW())
  RETURNING *
  `,
  [
    userId,
    event_date,   // 🔥 THIS IS THE IMPORTANT LINE
    null,
    null,
    null,
    null
  ]
);

    recapId = recapInsert.rows[0].id;

    const musicResult = await pool.query(
      `SELECT * FROM music_tracks WHERE id = $1 LIMIT 1`,
      [musicTrackId]
    );

    if (musicResult.rows.length === 0) {
      throw new Error("Music track not found");
    }

    const musicTrack = musicResult.rows[0];

    let photos = [];
    if (photoIds.length > 0) {
      const photoResult = await pool.query(
        `SELECT * FROM photos ORDER BY uploaded_at ASC`
      );

      photos = photoResult.rows.filter(
        (row) => photoIds.includes(Number(row.id)) && rowMatchesOwner(row, owners)
      );
    }

    let videos = [];
    if (videoIds.length > 0) {
      const videoResult = await pool.query(
        `SELECT * FROM videos ORDER BY uploaded_at ASC`
      );

      videos = videoResult.rows.filter(
        (row) => videoIds.includes(String(row.id)) && rowMatchesOwner(row, owners)
      );
    }

    if (photoIds.length > 0 && photos.length !== photoIds.length) {
      throw new Error("One or more selected photos were not found or not owned by user");
    }

    if (videoIds.length > 0 && videos.length !== videoIds.length) {
      throw new Error("One or more selected videos were not found or not owned by user");
    }

    let orderedItems = [];

    if (selectedMedia.length > 0) {
      orderedItems = selectedMedia
        .filter((item) => item && (item.media_type === "photo" || item.media_type === "video"))
        .map((item) => ({
          media_type: item.media_type,
          media_id: String(item.media_id),
        }));
    } else {
      orderedItems = [
        ...photos.map((p) => ({ media_type: "photo", media_id: String(p.id) })),
        ...videos.map((v) => ({ media_type: "video", media_id: String(v.id) })),
      ];
    }

    const photoMap = new Map(photos.map((p) => [String(p.id), p]));
    const videoMap = new Map(videos.map((v) => [String(v.id), v]));

    const musicSigned = await supabaseAdmin.storage
      .from("music")
      .createSignedUrl(musicTrack.storage_path, 60 * 60);

    if (musicSigned.error || !musicSigned.data?.signedUrl) {
      throw new Error(musicSigned.error?.message || "Failed to sign music URL");
    }

    const musicPath = path.join(workDir, "music.mp3");
    await downloadToFile(musicSigned.data.signedUrl, musicPath);

    const clipPaths = [];

    for (let i = 0; i < orderedItems.length; i++) {
      const item = orderedItems[i];

      if (item.media_type === "photo") {
        const photo = photoMap.get(item.media_id);
        if (!photo) throw new Error(`Photo not found in ordered selection: ${item.media_id}`);

        const signedUrl = await getSignedPhotoUrl(photo);
        const originalExt =
          path.extname(photo.storage_path || photo.filename || "").toLowerCase() || ".jpg";
        const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".heic"].includes(originalExt)
          ? originalExt
          : ".jpg";

        const photoFile = path.join(workDir, `photo_${i}${safeExt}`);
        const clipFile = path.join(workDir, `clip_${i}_photo.mp4`);

        await downloadToFile(signedUrl, photoFile);

        await runFfmpeg([
  "-y",
  "-i", photoFile,
  "-vf",
  "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.0015,1.15)':d=62:s=1080x1920:fps=25",
  "-frames:v", "62",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  clipFile,
]);
        clipPaths.push(clipFile);
      }

      if (item.media_type === "video") {
        const video = videoMap.get(item.media_id);
        if (!video) throw new Error(`Video not found in ordered selection: ${item.media_id}`);

        const signedUrl = await getSignedVideoUrl(video);
        const inputFile = path.join(workDir, `video_${i}.mp4`);
        const clipFile = path.join(workDir, `clip_${i}_video.mp4`);

        await downloadToFile(signedUrl, inputFile);

        await runFfmpeg([
  "-y",
  "-ss", "1",
  "-i", inputFile,
  "-t", "4",
  "-vf",
  "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
  "-r", "25",
  "-an",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  clipFile,
]);
        clipPaths.push(clipFile);
      }
    }

    if (!clipPaths.length) {
      throw new Error("No clips were generated");
    }

    const concatListPath = path.join(workDir, "concat.txt");
    const concatContent = clipPaths
      .map((clip) => `file '${clip.replace(/'/g, "'\\''")}'`)
      .join("\n");

    await fs.writeFile(concatListPath, concatContent, "utf8");

    const mergedVideoPath = path.join(workDir, "merged.mp4");
    const finalVideoPath = path.join(workDir, "final.mp4");

    await runFfmpeg([
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatListPath,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      mergedVideoPath,
    ]);

    await runFfmpeg([
      "-y",
      "-i", mergedVideoPath,
      "-i", musicPath,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-shortest",
      finalVideoPath,
    ]);

    const finalBuffer = await fs.readFile(finalVideoPath);
    const recapStoragePath = `${String(userId).replace(/[^a-zA-Z0-9._-]/g, "_")}/${recapId}.mp4`;

    const uploadResult = await supabaseAdmin.storage
      .from("recaps")
      .upload(recapStoragePath, finalBuffer, {
        contentType: "video/mp4",
        upsert: true,
      });

    if (uploadResult.error) {
      throw new Error(uploadResult.error.message);
    }

    let durationSeconds = null;
    try {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        finalVideoPath,
      ]);

      durationSeconds = Math.round(Number(stdout.trim())) || null;
    } catch {
      durationSeconds = null;
    }

    await pool.query(
      `
      UPDATE recaps
      SET storage_path = $1,
          file_size = $2,
          duration = $3
      WHERE id = $4
      `,
      [recapStoragePath, finalBuffer.length, durationSeconds, recapId]
    );

    let signedRecapUrl = null;
    try {
      const signed = await supabaseAdmin.storage
        .from("recaps")
        .createSignedUrl(recapStoragePath, 60 * 60 * 24 * 30);

      if (!signed.error && signed.data?.signedUrl) {
        signedRecapUrl = signed.data.signedUrl;
      }
    } catch {}

    return NextResponse.json({
      message: "Memory reel generated successfully",
      recapId,
      storage_path: recapStoragePath,
      url: signedRecapUrl,
      duration: durationSeconds,
    });
  } catch (err) {
    console.error("GENERATE RECAP ERROR:", err);

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {}
  }
}