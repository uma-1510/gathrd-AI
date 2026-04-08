import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";

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

function isVideoItem(item) {
  return (
    item?.media_type === "video" ||
    item?.mime_type?.startsWith("video/") ||
    /\.(mp4|mov|avi|webm|mkv)$/i.test(item?.filename || "")
  );
}

function getItemDate(item) {
  return item?.date_taken || item?.uploaded_at || null;
}

function getDayKey(item) {
  const raw = getItemDate(item);
  if (!raw) return null;

  try {
    return new Date(raw).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function scoreMedia(item) {
  let score = 0;

  if (isVideoItem(item)) {
    score += 6;

    const duration = Number(item.duration || 0);
    if (duration >= 3 && duration <= 8) score += 5;
    else if (duration > 8 && duration <= 15) score += 3;
    else if (duration > 0 && duration < 3) score += 1;

    if (item.place_name) score += 2;
    if (item.ai_description) score += 2;
  } else {
    if (item.dominant_emotion === "happy" || item.dominant_emotion === "excited") score += 4;
    else if (item.dominant_emotion && item.dominant_emotion !== "neutral") score += 2;

    if (Number(item.face_count || 0) > 0) score += 2;
    if (item.place_name) score += 2;
    if (item.ai_description) score += 2;
    if (item.width && item.height) score += 1;
  }

  return score;
}

function pickBestItems(items) {
  const scored = [...items]
    .map((item) => ({
      ...item,
      reel_score: scoreMedia(item),
    }))
    .sort((a, b) => {
      if (b.reel_score !== a.reel_score) return b.reel_score - a.reel_score;
      return new Date(getItemDate(a) || 0) - new Date(getItemDate(b) || 0);
    });

  const photos = scored.filter((item) => !isVideoItem(item));
  const videos = scored.filter((item) => isVideoItem(item));

  const selectedVideos = videos.slice(0, Math.min(3, videos.length));
  const selectedPhotos = photos.slice(0, Math.min(7, photos.length));

  const selected = [];
  let p = 0;
  let v = 0;

  while (selected.length < 10 && (p < selectedPhotos.length || v < selectedVideos.length)) {
    if (v < selectedVideos.length) {
      selected.push(selectedVideos[v++]);
    }

    if (p < selectedPhotos.length && selected.length < 10) {
      selected.push(selectedPhotos[p++]);
    }
  }

  return selected;
}

function pickMood(items) {
  const emotions = items
    .filter((item) => !isVideoItem(item))
    .map((item) => item.dominant_emotion);

  const happyCount = emotions.filter((e) => e === "happy" || e === "excited").length;
  const calmCount = emotions.filter((e) => e === "calm" || e === "neutral").length;

  if (happyCount >= 2) return "upbeat";
  if (calmCount >= 2) return "cinematic";
  return "emotional";
}

function buildEventTitle(items, eventId) {
  const place = items.find((item) => item.place_name)?.place_name || null;
  const date = items[0] ? getDayKey(items[0]) : null;

  if (place && date) return `${place} Day Out`;
  if (place) return `${place} Memory Reel`;
  if (date) return `Memory Reel ${date}`;
  return `Memory Reel ${eventId}`;
}

export async function POST(req, context) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await initDb();

    const owners = getPossibleOwners(session);
    const params = await context.params;
    const eventId = params?.id;

    console.log("GENERATE REEL ROUTE HIT");
    console.log("EVENT ID:", eventId);

    if (!eventId) {
      return NextResponse.json({ error: "Missing event id" }, { status: 400 });
    }

    const [photosResult, videosResult] = await Promise.all([
      pool.query(`SELECT * FROM photos ORDER BY uploaded_at DESC`),
      pool.query(`SELECT * FROM videos ORDER BY uploaded_at DESC`),
    ]);

    const photos = photosResult.rows
      .filter((row) => rowMatchesOwner(row, owners))
      .map((row) => ({ ...row, media_type: "photo" }));

    const videos = videosResult.rows
      .filter((row) => rowMatchesOwner(row, owners))
      .map((row) => ({ ...row, media_type: "video" }));

    const allItems = [...photos, ...videos];
    const eventItems = allItems.filter((item) => getDayKey(item) === eventId);

    console.log("TOTAL ITEMS:", allItems.length);
    console.log("EVENT ITEMS:", eventItems.length);

    if (!eventItems.length) {
      return NextResponse.json({ error: "No media found for this event" }, { status: 404 });
    }

    const selectedItems = pickBestItems(eventItems);
    const mood = pickMood(selectedItems);
    const title = buildEventTitle(eventItems, eventId);

    const photoIds = selectedItems
      .filter((item) => item.media_type === "photo")
      .map((item) => Number(item.id))
      .filter((id) => Number.isInteger(id));

    const videoIds = selectedItems
      .filter((item) => item.media_type === "video")
      .map((item) => String(item.id));

    const selectedMedia = selectedItems.map((item) => ({
      media_type: item.media_type,
      media_id: String(item.id),
    }));

    console.log("SELECTED ITEMS COUNT:", selectedItems.length);
    console.log("MOOD:", mood);
    console.log("PHOTO IDS:", photoIds);
    console.log("VIDEO IDS:", videoIds);

    // Pick music directly from DB instead of calling /api/music/pick
    let musicResult = await pool.query(
      `
      SELECT *
      FROM music_tracks
      WHERE LOWER(mood) = $1
      ORDER BY RANDOM()
      LIMIT 1
      `,
      [String(mood).toLowerCase()]
    );

    if (musicResult.rows.length === 0) {
      musicResult = await pool.query(
        `
        SELECT *
        FROM music_tracks
        ORDER BY RANDOM()
        LIMIT 1
        `
      );
    }

    if (musicResult.rows.length === 0) {
      return NextResponse.json(
        { error: "No music tracks found in music_tracks table" },
        { status: 500 }
      );
    }

    const pickedTrack = musicResult.rows[0];

    console.log("PICKED TRACK:", {
      id: pickedTrack.id,
      title: pickedTrack.title,
      mood: pickedTrack.mood,
      storage_path: pickedTrack.storage_path,
    });

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    const recapRes = await fetch(`${baseUrl}/api/recaps/generate`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    cookie: req.headers.get("cookie") || "",
  },
  body: JSON.stringify({
    event_date: eventId,
    photoIds,
    videoIds,
    musicTrackId: pickedTrack.id,
    selectedMedia,
  }),
});

    const recapData = await recapRes.json().catch(() => ({}));

    console.log("RECAP GENERATE STATUS:", recapRes.status);
    console.log("RECAP GENERATE DATA:", recapData);

    if (!recapRes.ok) {
      return NextResponse.json(
        { error: recapData.error || "Failed to generate reel" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "Memory reel generated successfully",
      eventId,
      title,
      mood,
      musicTrackId: pickedTrack.id,
      recap: recapData,
    });
  } catch (err) {
    console.error("EVENT REEL STARTER ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}