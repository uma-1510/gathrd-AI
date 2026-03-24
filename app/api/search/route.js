// app/api/search/route.js
// Conversational search with timezone-aware date filtering.
//
// The client sends ?tz=-240 (EDT) or ?tz=330 (IST) — the value of
// `new Date().getTimezoneOffset()` (positive = west of UTC).
// We use that to compute correct local midnight boundaries for
// "today", "yesterday", etc. so results match the user's calendar.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { embedText, toSqlVector } from "@/lib/hf";

// ── Timezone helpers 
// tzOffset: minutes behind UTC (EDT = 240, IST = -330, UTC = 0)
function localMidnightUTC(dateUTC, tzOffsetMinutes) {
  // Work out the calendar date in the user's local timezone, then
  // return the UTC timestamp that corresponds to 00:00:00 local.
  const localMs = dateUTC.getTime() - tzOffsetMinutes * 60 * 1000;
  const localDate = new Date(localMs);
  // Truncate to local midnight
  localDate.setUTCHours(0, 0, 0, 0);
  // Shift back to UTC equivalent
  return new Date(localDate.getTime() + tzOffsetMinutes * 60 * 1000);
}

function localEndOfDayUTC(dateUTC, tzOffsetMinutes) {
  const start = localMidnightUTC(dateUTC, tzOffsetMinutes);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

// ── Query intent parser 
function parseIntent(query, tzOffsetMinutes = 0) {
  const q = query.toLowerCase();
  const now = new Date();

  const intent = {
    raw: query,
    dateFilter: null,
    peopleFilter: [],
    eventKeywords: [],
    qualityFilter: null,
    semanticQuery: query,
  };

  // ── Year 
  const yearMatch = q.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearMatch) {
    intent.dateFilter = { ...(intent.dateFilter || {}), year: parseInt(yearMatch[1]) };
  }

  // ── Month name 
  const months = {
    january:1, february:2, march:3, april:4, may:5, june:6,
    july:7, august:8, september:9, october:10, november:11, december:12,
    jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
  };
  for (const [name, num] of Object.entries(months)) {
    if (q.includes(name)) {
      intent.dateFilter = { ...(intent.dateFilter || {}), month: num };
      break;
    }
  }

  // ── Relative time — timezone-aware 
  // Use `after`/`before` range instead of EXTRACT so we can use
  // COALESCE(date_taken, uploaded_at) and respect the user's local day.
  if (q.includes("today")) {
    intent.dateFilter = {
      after:  localMidnightUTC(now, tzOffsetMinutes),
      before: localEndOfDayUTC(now, tzOffsetMinutes),
    };
  } else if (q.includes("yesterday")) {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    intent.dateFilter = {
      after:  localMidnightUTC(yesterday, tzOffsetMinutes),
      before: localEndOfDayUTC(yesterday, tzOffsetMinutes),
    };
  } else if (q.includes("this week")) {
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
    intent.dateFilter = { after: weekAgo, before: now };
  } else if (q.includes("last week")) {
    const twoWeeks = new Date(now); twoWeeks.setDate(now.getDate() - 14);
    const oneWeek  = new Date(now); oneWeek.setDate(now.getDate() - 7);
    intent.dateFilter = { after: twoWeeks, before: oneWeek };
  } else if (q.includes("last month") || q.includes("past month")) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    intent.dateFilter = { after: start, before: end };
  } else if (q.includes("this month")) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    intent.dateFilter = { after: start, before: now };
  }

  // ── Event keywords 
  const events = [
    "birthday", "wedding", "graduation", "vacation", "holiday",
    "christmas", "new year", "anniversary", "party", "festival",
    "beach", "travel", "trip", "concert", "dinner", "lunch",
  ];
  for (const ev of events) {
    if (q.includes(ev)) intent.eventKeywords.push(ev);
  }

  // ── Quality filter 
  if (
    q.includes("best") || q.includes("instagram") || q.includes("clear") ||
    q.includes("good photo") || q.includes("nice photo")
  ) {
    intent.qualityFilter = "best";
    // Override semantic query — don't embed "instagram/best/today" literally.
    // Instead embed what a good photo actually looks like so the vector search
    // pulls sharp, bright, happy images rather than photos mentioning "instagram".
    intent.semanticQuery = "bright clear sharp photo smiling happy people good lighting vibrant colorful";
  }

  // ── People extraction 
  const peoplePatterns = [
    /with\s+([a-z][a-z\s]{1,20}?)(?:\s+(?:at|in|on|from|and|,|$))/gi,
    /of\s+([a-z][a-z\s]{1,20}?)(?:\s+(?:at|in|on|from|and|,|$))/gi,
    /\bmy\s+(mom|dad|mother|father|sister|brother|friend|wife|husband|partner)\b/gi,
    /([a-z][a-z]+)(?:'s|s')\s+(?:photo|picture|birthday|party)/gi,
  ];
  for (const re of peoplePatterns) {
    let m;
    while ((m = re.exec(q)) !== null) {
      const name = m[1]?.trim();
      if (name && name.length > 1 && !["the","my","a","an","some"].includes(name)) {
        intent.peopleFilter.push(name);
      }
    }
  }

  return intent;
}

// ── Embedding cache 
const embedCache = new Map();
function getCached(text) { return embedCache.get(text.toLowerCase().trim()) || null; }
function setCache(text, val) {
  if (embedCache.size > 100) embedCache.delete(embedCache.keys().next().value);
  embedCache.set(text.toLowerCase().trim(), val);
}

// ── Main search handler 
export async function GET(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q")?.trim();
    if (!query) return NextResponse.json({ photos: [], query: "" });

    // tz param: browser's `new Date().getTimezoneOffset()` (EDT = 240, IST = -330)
    const tzOffsetMinutes = parseInt(searchParams.get("tz") ?? "0", 10) || 0;

    const username = session.user.username;
    const intent = parseIntent(query, tzOffsetMinutes);

    // ── Build SQL filters 
    const conditions = ["p.uploaded_by = $1"];
    const values = [username];
    let paramIdx = 2;

    if (intent.dateFilter) {
      const df = intent.dateFilter;

      // year/month still use EXTRACT (not timezone-sensitive at that granularity)
      if (df.year) {
        conditions.push(`EXTRACT(YEAR  FROM COALESCE(p.date_taken, p.uploaded_at)) = $${paramIdx++}`);
        values.push(df.year);
      }
      if (df.month) {
        conditions.push(`EXTRACT(MONTH FROM COALESCE(p.date_taken, p.uploaded_at)) = $${paramIdx++}`);
        values.push(df.month);
      }

      // after/before use range comparison — works correctly with timezone-shifted boundaries
      if (df.after) {
        conditions.push(`COALESCE(p.date_taken, p.uploaded_at) >= $${paramIdx++}`);
        values.push(df.after);
      }
      if (df.before) {
        conditions.push(`COALESCE(p.date_taken, p.uploaded_at) <= $${paramIdx++}`);
        values.push(df.before);
      }
    }

    // ── Person filter 
    let joinClause = "";
    if (intent.peopleFilter.length > 0) {
      joinClause = `
        JOIN photo_people pp  ON pp.photo_id  = p.id
        JOIN people      per  ON per.id        = pp.person_id
                              AND per.username  = $1
      `;
      const nameConditions = intent.peopleFilter.map(name => {
        values.push(`%${name}%`);
        return `per.name ILIKE $${paramIdx++}`;
      });
      conditions.push(`(${nameConditions.join(" OR ")})`);
    }

    const whereClause = conditions.join(" AND ");

    // ── Vector search 
    let queryEmbedding = getCached(query);
    if (!queryEmbedding) {
      try {
        const emb = await embedText(intent.semanticQuery);
        queryEmbedding = toSqlVector(emb);
        setCache(query, queryEmbedding);
      } catch (err) {
        console.error("Query embedding failed:", err.message);
      }
    }

    let photos = [];

    if (queryEmbedding) {
      const sql = `
        SELECT DISTINCT p.*,
          ROUND(((1 - (p.embedding <=> $${paramIdx}::vector)) * 100)::numeric, 1) AS similarity_pct,
          1 - (p.embedding <=> $${paramIdx}::vector) AS similarity
        FROM photos p
        ${joinClause}
        WHERE ${whereClause}
          AND p.embedding IS NOT NULL
        ORDER BY similarity DESC
        LIMIT 50
      `;
      values.push(queryEmbedding);

      try {
        const result = await pool.query(sql, values);
        photos = result.rows.filter(r => r.similarity >= 0.35);
      } catch (err) {
        console.error("Vector search failed:", err.message);
      }
    }

    // ── Text fallback 
    if (photos.length === 0) {
      const lowerWords = query.toLowerCase().split(/\s+/).filter(Boolean);
      const fallbackSql = `
        SELECT DISTINCT p.*, 0 AS similarity_pct, 0 AS similarity
        FROM photos p
        ${joinClause}
        WHERE ${whereClause}
        ORDER BY COALESCE(p.date_taken, p.uploaded_at) DESC
        LIMIT 100
      `;
      const fallbackResult = await pool.query(fallbackSql, values.slice(0, paramIdx - 1));
      photos = fallbackResult.rows.filter(photo => {
        const haystack = [
          photo.ai_description || "",
          photo.filename || "",
          photo.dominant_emotion || "",
          photo.camera_make || "",
        ].join(" ").toLowerCase();
        return lowerWords.some(w => haystack.includes(w));
      });
    }

    // ── Quality sort 
    if (intent.qualityFilter === "best") {
      // Emotion is the primary signal — happy/excited photos rank first.
      // Sad, angry, fearful photos get a heavy negative penalty.
      const EMOTION_SCORE = {
        happy: 5, excited: 5, surprised: 3, calm: 2,
        neutral: 1, sad: -3, fearful: -3, angry: -4, disgusted: -4,
      };
      photos = photos.sort((a, b) => {
        const score = (p) =>
          (EMOTION_SCORE[p.dominant_emotion] ?? 0) * 4 +  // emotion is primary
          (p.width || 0) * (p.height || 0) / 1_000_000 +  // resolution bonus
          (p.face_count > 0 ? 2 : 0) +                    // has people
          (p.similarity || 0) * 2;                         // semantic match
        return score(b) - score(a);
      });
    }

    // ── Attach people names 
    if (photos.length > 0) {
      const photoIds = photos.map(p => p.id);
      const peopleResult = await pool.query(
        `SELECT pp.photo_id, per.name, pp.confidence
         FROM photo_people pp
         JOIN people per ON per.id = pp.person_id
         WHERE pp.photo_id = ANY($1) AND per.username = $2`,
        [photoIds, username],
      );
      const peopleByPhoto = {};
      for (const row of peopleResult.rows) {
        if (!peopleByPhoto[row.photo_id]) peopleByPhoto[row.photo_id] = [];
        peopleByPhoto[row.photo_id].push(row.name);
      }
      photos = photos.map(p => ({ ...p, people: peopleByPhoto[p.id] || [] }));
    }

    return NextResponse.json({
      photos,
      query,
      intent: {
        dateFilter:    intent.dateFilter,
        peopleFilter:  intent.peopleFilter,
        eventKeywords: intent.eventKeywords,
        qualityFilter: intent.qualityFilter,
      },
      count: photos.length,
    });
  } catch (err) {
    console.error("Search error:", err);
    return NextResponse.json({ error: "Search failed", details: err.message }, { status: 500 });
  }
}