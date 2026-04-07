// app/api/search/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { embedText, toSqlVector } from "@/lib/hf";

// ── Timezone helpers ──────────────────────────────────────────────────────────
function localMidnightUTC(dateUTC, tzOffsetMinutes) {
  const localMs = dateUTC.getTime() - tzOffsetMinutes * 60 * 1000;
  const localDate = new Date(localMs);
  localDate.setUTCHours(0, 0, 0, 0);
  return new Date(localDate.getTime() + tzOffsetMinutes * 60 * 1000);
}

function localEndOfDayUTC(dateUTC, tzOffsetMinutes) {
  const start = localMidnightUTC(dateUTC, tzOffsetMinutes);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

// ── Query intent parser ───────────────────────────────────────────────────────
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

  // ── Year ──────────────────────────────────────────────────────────────────
  const yearMatch = q.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearMatch) {
    intent.dateFilter = { ...(intent.dateFilter || {}), year: parseInt(yearMatch[1]) };
  }

  // ── Month name ────────────────────────────────────────────────────────────
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

  // ── Relative time ─────────────────────────────────────────────────────────
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

  // ── Event keywords ────────────────────────────────────────────────────────
  const events = [
    "birthday", "wedding", "graduation", "vacation", "holiday",
    "christmas", "new year", "anniversary", "party", "festival",
    "beach", "travel", "trip", "concert", "dinner", "lunch",
  ];
  for (const ev of events) {
    if (q.includes(ev)) intent.eventKeywords.push(ev);
  }

  // ── Quality filter ────────────────────────────────────────────────────────
  if (
    q.includes("best") || q.includes("instagram") || q.includes("clear") ||
    q.includes("good photo") || q.includes("nice photo")
  ) {
    intent.qualityFilter = "best";
    intent.semanticQuery = "bright clear sharp photo smiling happy people good lighting vibrant colorful";
  }

  // ── People extraction ─────────────────────────────────────────────────────
  // Stop-words that should never be treated as names
  const STOP = new Set(["the","my","a","an","some","all","any","their","our","your",
                        "photo","photos","picture","pictures","pic","pics","image","images",
                        "show","find","get","with","from","of","in","on","at","and","or"]);

  const foundNames = new Set();

  // Pattern 1: "with <name>" — name ends at preposition or end-of-string
  // Pattern 2: "of <name>"  — same
  const prepPatterns = [
    /\bwith\s+([a-z][a-z\s]{1,20}?)(?:\s+(?:at|in|on|from|and|,)|$)/gi,
    /\bof\s+([a-z][a-z\s]{1,20}?)(?:\s+(?:at|in|on|from|and|,)|$)/gi,
  ];
  for (const re of prepPatterns) {
    let m;
    while ((m = re.exec(q)) !== null) {
      const name = m[1]?.trim();
      if (name && name.length > 1 && !STOP.has(name)) foundNames.add(name);
    }
  }

  // Pattern 3: possessive — "gautam's photos"
  const possessiveRe = /([a-z][a-z]+)(?:'s|s')\s+(?:photo|picture|pic|image)/gi;
  let m;
  while ((m = possessiveRe.exec(q)) !== null) {
    const name = m[1]?.trim();
    if (name && !STOP.has(name)) foundNames.add(name);
  }

  // Pattern 4: relationship words
  const relRe = /\bmy\s+(mom|dad|mother|father|sister|brother|friend|wife|husband|partner)\b/gi;
  while ((m = relRe.exec(q)) !== null) {
    foundNames.add(m[1].trim());
  }

  // Pattern 5 (KEY FIX): bare name queries — "gautam", "photos of yashu", "show yashu"
  // Strip known noise words and treat remaining single tokens as potential names
  const stripped = q
    .replace(/\b(show|find|get|display|search|look for)\b/g, "")
    .replace(/\b(me|my|all|the|a|an)\b/g, "")
    .replace(/\b(photos?|pictures?|pics?|images?)\b/g, "")
    .replace(/\b(of|with|from|in|on|at|and|or)\b/g, "")
    .replace(/\b(today|yesterday|this week|last week|this month|last month)\b/g, "")
    .replace(/\b(best|good|nice|clear)\b/g, "")
    .trim();

  for (const token of stripped.split(/\s+/)) {
    const t = token.replace(/[^a-z]/g, "").trim();
    // Only treat as a name if it's 3+ chars, not a stop word, and not already found
    if (t.length >= 3 && !STOP.has(t) && !foundNames.has(t)) {
      // Check it doesn't look like a date/event/quality term already handled
      const alreadyHandled = [...events, "best","instagram","clear","good","nice",
        ...Object.keys(months)].includes(t);
      if (!alreadyHandled) foundNames.add(t);
    }
  }

  intent.peopleFilter = [...foundNames];

  return intent;
}

// ── Embedding cache ───────────────────────────────────────────────────────────
const embedCache = new Map();
function getCached(text) { return embedCache.get(text.toLowerCase().trim()) || null; }
function setCache(text, val) {
  if (embedCache.size > 100) embedCache.delete(embedCache.keys().next().value);
  embedCache.set(text.toLowerCase().trim(), val);
}

// ── Main search handler ───────────────────────────────────────────────────────
export async function GET(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q")?.trim();
    if (!query) return NextResponse.json({ photos: [], query: "" });

    const tzOffsetMinutes = parseInt(searchParams.get("tz") ?? "0", 10) || 0;

    const username = session.user.username;
    const intent = parseIntent(query, tzOffsetMinutes);

    // ── Build SQL filters ─────────────────────────────────────────────────
    const conditions = ["p.uploaded_by = $1"];
    const values = [username];
    let paramIdx = 2;

    if (intent.dateFilter) {
      const df = intent.dateFilter;
      if (df.year) {
        conditions.push(`EXTRACT(YEAR  FROM COALESCE(p.date_taken, p.uploaded_at)) = $${paramIdx++}`);
        values.push(df.year);
      }
      if (df.month) {
        conditions.push(`EXTRACT(MONTH FROM COALESCE(p.date_taken, p.uploaded_at)) = $${paramIdx++}`);
        values.push(df.month);
      }
      if (df.after) {
        conditions.push(`COALESCE(p.date_taken, p.uploaded_at) >= $${paramIdx++}`);
        values.push(df.after);
      }
      if (df.before) {
        conditions.push(`COALESCE(p.date_taken, p.uploaded_at) <= $${paramIdx++}`);
        values.push(df.before);
      }
    }

    // ── Person filter — JOIN narrows to photos of that person ─────────────
    let joinClause = "";
    const hasPeopleFilter = intent.peopleFilter.length > 0;

    if (hasPeopleFilter) {
      // First check if any of the name tokens match actual people in the DB.
      // If none match, skip the people filter so we don't get zero results.
      const nameChecks = intent.peopleFilter.map((_, i) => `per.name ILIKE $${paramIdx + i}`);
      const checkValues = intent.peopleFilter.map(n => `%${n}%`);
      const checkResult = await pool.query(
        `SELECT COUNT(*) FROM people per WHERE per.username = $1 AND (${nameChecks.join(" OR ")})`,
        [username, ...checkValues]
      );
      const matchCount = parseInt(checkResult.rows[0].count, 10);

      if (matchCount > 0) {
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
      // If no matching people in DB, fall through without JOIN so we still
      // get semantic results rather than an empty page
    }

    const whereClause = conditions.join(" AND ");

    // ── Embed the query ───────────────────────────────────────────────────
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

        // KEY FIX: when searching by person name, the JOIN already guarantees
        // the right photos — don't filter by similarity score.
        // For general queries, keep the 0.35 threshold to avoid noise.
        if (hasPeopleFilter) {
          photos = result.rows; // trust the JOIN, no similarity cutoff
        } else {
          photos = result.rows.filter(r =>
  intent.peopleFilter.length > 0 ? r.similarity >= 0.30 : r.similarity >= 0.50
);
        }
      } catch (err) {
        console.error("Vector search failed:", err.message);
      }
    }

    // ── Text fallback (when embedding unavailable or no results) ──────────
    if (photos.length === 0) {
      const lowerWords = query.toLowerCase().split(/\s+/).filter(Boolean);
      const fallbackSql = `
        SELECT p.*, 0 AS similarity_pct, 0 AS similarity
        FROM photos p
        ${joinClause}
        WHERE ${whereClause}
        ORDER BY COALESCE(p.date_taken, p.uploaded_at) DESC
        LIMIT 100
      `;
      const fallbackResult = await pool.query(fallbackSql, values.slice(0, paramIdx - 1));

      // If we had a people JOIN, trust it; otherwise also check description text
      if (hasPeopleFilter) {
        photos = fallbackResult.rows;
      } else {
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
    }

    // ── Quality sort ──────────────────────────────────────────────────────
    if (intent.qualityFilter === "best") {
      const EMOTION_SCORE = {
        happy: 5, excited: 5, surprised: 3, calm: 2,
        neutral: 1, sad: -3, fearful: -3, angry: -4, disgusted: -4,
      };
      photos = photos.sort((a, b) => {
        const score = (p) =>
          (EMOTION_SCORE[p.dominant_emotion] ?? 0) * 4 +
          (p.width || 0) * (p.height || 0) / 1_000_000 +
          (p.face_count > 0 ? 2 : 0) +
          (p.similarity || 0) * 2;
        return score(b) - score(a);
      });
    }

    // ── Attach people names to results ────────────────────────────────────
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