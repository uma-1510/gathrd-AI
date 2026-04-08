import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";
import supabaseAdmin from "@/lib/supabaseAdmin";

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

function scoreItem(item) {
  let score = 0;

  if (isVideoItem(item)) {
    score += 3;

    const duration = Number(item.duration || 0);
    if (duration >= 3 && duration <= 10) score += 2;
    else if (duration > 0 && duration < 3) score += 1;
  } else {
    if (item.dominant_emotion === "happy" || item.dominant_emotion === "excited") score += 4;
    else if (item.dominant_emotion && item.dominant_emotion !== "neutral") score += 2;

    if (Number(item.face_count || 0) > 0) score += 2;
    if (item.place_name) score += 2;
    if (item.ai_description) score += 2;
    if (item.width && item.height) score += 1;
  }

  if (getItemDate(item)) score += 1;

  return score;
}

function buildTitle(group) {
  const place = group.find((item) => item.place_name)?.place_name;
  const cover = [...group].sort((a, b) => scoreItem(b) - scoreItem(a))[0];
  const text = `${cover?.ai_description || ""} ${cover?.filename || ""}`.toLowerCase();

  if (place) return `${place} Memory`;
  if (text.includes("birthday")) return "Birthday Recap";
  if (text.includes("anniversary")) return "Anniversary Recap";
  if (text.includes("trip") || text.includes("travel")) return "Trip Highlight";

  return "Memory Highlight";
}

function buildSummary(group, cover) {
  const count = group.length;
  const desc = cover?.ai_description || "A memorable moment captured";
  const place = cover?.place_name;
  const emotion = cover?.dominant_emotion;

  let summary = desc;

  if (place && !summary.toLowerCase().includes(String(place).toLowerCase())) {
    summary += ` at ${place}`;
  }

  if (emotion && emotion !== "neutral") {
    summary += `, feeling ${emotion}`;
  }

  summary += `. ${count} item${count !== 1 ? "s" : ""} in this memory.`;

  return summary;
}

async function attachSignedUrl(item) {
  const bucket = isVideoItem(item) ? "videos" : "photos";

  if (!item.storage_path) {
    return { ...item, url: item.url || null };
  }

  try {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(item.storage_path, 60 * 60 * 24 * 30);

    if (error || !data?.signedUrl) {
      return { ...item, url: item.url || null };
    }

    return { ...item, url: data.signedUrl };
  } catch {
    return { ...item, url: item.url || null };
  }
}

async function getSignedRecapUrl(recap) {
  if (!recap?.storage_path) return recap?.url || null;

  try {
    const { data, error } = await supabaseAdmin.storage
      .from("recaps")
      .createSignedUrl(recap.storage_path, 60 * 60 * 24 * 30);

    if (error || !data?.signedUrl) {
      return recap.url || null;
    }

    return data.signedUrl;
  } catch {
    return recap.url || null;
  }
}

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await initDb();

    const userId = getUserId(session);
    const owners = getPossibleOwners(session);

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

    const allItems = [...photos, ...videos].sort(
      (a, b) => new Date(getItemDate(b) || 0) - new Date(getItemDate(a) || 0)
    );

    console.log("MEMORY HIGHLIGHTS TOTAL ITEMS:", allItems.length);

    const groups = {};

    for (const item of allItems) {
      const dayKey = getDayKey(item);
      if (!dayKey) continue;

      if (!groups[dayKey]) groups[dayKey] = [];
      groups[dayKey].push(item);
    }

    console.log(
      "MEMORY HIGHLIGHTS GROUPS:",
      Object.entries(groups).map(([day, items]) => ({
        day,
        count: items.length,
      }))
    );

    const validGroups = Object.entries(groups)
      .filter(([, items]) => items.length >= 1)
      .sort((a, b) => new Date(b[0]) - new Date(a[0]));

    const highlights = [];

    for (const [day, items] of validGroups) {
      const sorted = [...items].sort((a, b) => scoreItem(b) - scoreItem(a));
      const coverRaw = sorted[0];
      const cover = await attachSignedUrl(coverRaw);

      let recap = null;
      let hasRecap = false;
      let recapUrl = null;

      try {
        const recapResult = await pool.query(
          `
          SELECT *
          FROM recaps
          WHERE user_id = $1
            AND event_date = $2
          ORDER BY id DESC
          LIMIT 1
          `,
          [userId, day]
        );

        if (recapResult.rows.length > 0) {
          recap = recapResult.rows[0];
          hasRecap = true;
          recapUrl = await getSignedRecapUrl(recap);
        }
      } catch (err) {
        console.error("RECAP LOOKUP ERROR:", err);
      }

      highlights.push({
        id: day,
        title: buildTitle(items),
        summary: buildSummary(items, coverRaw),
        cover_url: cover.url || null,
        cover_type: isVideoItem(coverRaw) ? "video" : "photo",
        date: day,
        place_name: coverRaw.place_name || null,
        count: items.length,
        has_recap: hasRecap,
        recap_id: recap?.id || null,
        recap_url: recapUrl,
        recap_storage_path: recap?.storage_path || null,
      });
    }

    return NextResponse.json({ highlights: highlights.slice(0, 8) });
  } catch (err) {
    console.error("MEMORY HIGHLIGHTS ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}