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

// ── Embedding cache ───────────────────────────────────────────────────────────
const embedCache = new Map();
function getCached(text) { return embedCache.get(text.toLowerCase().trim()) || null; }
function setCache(text, val) {
  if (embedCache.size > 100) embedCache.delete(embedCache.keys().next().value);
  embedCache.set(text.toLowerCase().trim(), val);
}

// ── Query intent parser ───────────────────────────────────────────────────────
// Returns:
//   selfFilter   : true  → user said "my photos", "me", "of myself" etc.
//   peopleFilter : string[] → named people extracted from query  e.g. ["pooja"]
//   dateFilter   : object | null
//   qualityFilter: "best" | null
//   locationQuery: string | null  → e.g. "paris"
//   semanticQuery: string         → cleaned text for vector embedding
async function parseIntent(query, tzOffsetMinutes = 0, username) {
  const q = query.toLowerCase();
  const now = new Date();

  const intent = {
    raw:          query,
    dateFilter:   null,
    peopleFilter: [],   // named people (e.g. "pooja")
    selfFilter:   false, // true when user says "my photos", "me", "of myself"
    qualityFilter: null,
    locationQuery: null,
    semanticQuery: query,
  };

  // ── 1. Self-reference detection ───────────────────────────────────────────
  // "my photos", "photos of me", "best of me", "show me", "my best", etc.
  const selfPatterns = [
    /\bmy\s+photos?\b/i,
    /\bphotos?\s+of\s+me\b/i,
    /\bof\s+myself\b/i,
    /\bpictures?\s+of\s+me\b/i,
    /\bshow\s+me\s+my\b/i,
    /\bmy\s+best\b/i,
    /\bbest\s+(?:photos?\s+)?of\s+me\b/i,
    /\bmy\s+(?:instagram|selfie|pic)\b/i,
  ];
  if (selfPatterns.some(re => re.test(q))) {
    intent.selfFilter = true;
  }

  // ── 2. Named people extraction ────────────────────────────────────────────
  // Fetch all tagged people names for this user so we can match them precisely
  // instead of guessing from regex alone.
  let knownPeople = [];
  try {
    const res = await pool.query(
      "SELECT name FROM people WHERE username = $1",
      [username]
    );
    knownPeople = res.rows.map(r => r.name.toLowerCase());
  } catch { /* non-fatal — fall back to regex only */ }

  // First pass: check if any known tagged name appears in the query
  for (const personName of knownPeople) {
    // Match "pooja", "pooja's", "of pooja", "with pooja", "show pooja"
    const escaped = personName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}(?:'s)?\\b`, "i");
    if (re.test(q)) {
      intent.peopleFilter.push(personName);
    }
  }

  // Second pass (regex fallback for names not yet tagged):
  // Only run if no known name was found
  if (intent.peopleFilter.length === 0) {
    const peoplePatterns = [
      // "pooja's photos", "rahul's pictures"
      /\b([a-z][a-z]{1,20})(?:'s)\s+(?:photos?|pictures?|pics?)\b/gi,
      // "photos of pooja", "pictures of rahul" — name must end string or hit a stop word
      /\b(?:photos?|pictures?|pics?)\s+of\s+([a-z][a-z\s]{1,20?})(?:\s+(?:from|at|in|on|and)|$)/gi,
      // "with pooja at", "with rahul"
      /\bwith\s+([a-z][a-z\s]{1,20?})(?:\s+(?:at|in|on|from|and|,)|$)/gi,
      // "show pooja", "find rahul"
      /\b(?:show|find|get)\s+([a-z][a-z]{1,20})(?:'s)?\s+photos?\b/gi,
    ];
    const stopWords = new Set(["the","my","a","an","some","me","i","best","good","nice","all","from","of","in","at","on"]);
    for (const re of peoplePatterns) {
      let m;
      while ((m = re.exec(q)) !== null) {
        const name = m[1]?.trim();
        if (name && name.length > 1 && !stopWords.has(name)) {
          intent.peopleFilter.push(name);
        }
      }
    }
  }

  // Deduplicate
  intent.peopleFilter = [...new Set(intent.peopleFilter)];

  // ── 3. Quality filter ─────────────────────────────────────────────────────
  if (
    q.includes("best") || q.includes("instagram") || q.includes("clear") ||
    q.includes("good photo") || q.includes("nice photo") || q.includes("top photos")
  ) {
    intent.qualityFilter = "best";
    // Don't embed "instagram" literally — embed what a great photo looks like
    intent.semanticQuery = "bright clear sharp smiling happy good lighting vibrant colorful portrait";
  }

  // ── 4. Location extraction ────────────────────────────────────────────────
  // "from paris", "in paris", "at paris", "paris photos"
  const locationMatch =
    q.match(/\b(?:from|in|at)\s+([a-z][a-z\s]{2,20?})(?:\s+(?:photos?|pictures?|in|at|from|on)|$)/i) ||
    q.match(/\b([a-z][a-z\s]{2,20?})\s+photos?\b/i);
  if (locationMatch) {
    const loc = locationMatch[1]?.trim();
    const locationStopWords = new Set(["my","the","best","good","nice","all","some","today","yesterday"]);
    if (loc && !locationStopWords.has(loc) && !intent.peopleFilter.includes(loc)) {
      intent.locationQuery = loc;
    }
  }

  // ── 5. Date filter ────────────────────────────────────────────────────────
  const yearMatch = q.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearMatch) intent.dateFilter = { ...(intent.dateFilter || {}), year: parseInt(yearMatch[1]) };

  const months = {
    january:1,february:2,march:3,april:4,may:5,june:6,
    july:7,august:8,september:9,october:10,november:11,december:12,
    jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
  };
  for (const [name, num] of Object.entries(months)) {
    if (q.includes(name)) {
      intent.dateFilter = { ...(intent.dateFilter || {}), month: num };
      break;
    }
  }

  if (q.includes("today")) {
    intent.dateFilter = { after: localMidnightUTC(now, tzOffsetMinutes), before: localEndOfDayUTC(now, tzOffsetMinutes) };
  } else if (q.includes("yesterday")) {
    const y = new Date(now.getTime() - 86400000);
    intent.dateFilter = { after: localMidnightUTC(y, tzOffsetMinutes), before: localEndOfDayUTC(y, tzOffsetMinutes) };
  } else if (q.includes("this week")) {
    const w = new Date(now); w.setDate(now.getDate() - 7);
    intent.dateFilter = { after: w, before: now };
  } else if (q.includes("last week")) {
    const t = new Date(now); t.setDate(now.getDate() - 14);
    const o = new Date(now); o.setDate(now.getDate() - 7);
    intent.dateFilter = { after: t, before: o };
  } else if (q.includes("last month") || q.includes("past month")) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    intent.dateFilter = { after: start, before: end };
  } else if (q.includes("this month")) {
    intent.dateFilter = { after: new Date(now.getFullYear(), now.getMonth(), 1), before: now };
  }

  return intent;
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

    // Pass username so parseIntent can look up tagged people names from DB
    const intent = await parseIntent(query, tzOffsetMinutes, username);

    // ── Build SQL ─────────────────────────────────────────────────────────────
    // Always scope to this user's uploads
    const conditions = ["p.uploaded_by = $1"];
    const values     = [username];
    let   paramIdx   = 2;

    // ── Date filter
    if (intent.dateFilter) {
      const df = intent.dateFilter;
      if (df.year)   { conditions.push(`EXTRACT(YEAR  FROM COALESCE(p.date_taken, p.uploaded_at)) = $${paramIdx++}`); values.push(df.year); }
      if (df.month)  { conditions.push(`EXTRACT(MONTH FROM COALESCE(p.date_taken, p.uploaded_at)) = $${paramIdx++}`); values.push(df.month); }
      if (df.after)  { conditions.push(`COALESCE(p.date_taken, p.uploaded_at) >= $${paramIdx++}`); values.push(df.after); }
      if (df.before) { conditions.push(`COALESCE(p.date_taken, p.uploaded_at) <= $${paramIdx++}`); values.push(df.before); }
    }

    // ── Location filter (against AI description + location fields)
    if (intent.locationQuery) {
      values.push(`%${intent.locationQuery}%`);
      conditions.push(`(
        p.ai_description ILIKE $${paramIdx}
        OR p.location_name ILIKE $${paramIdx}
        OR p.city          ILIKE $${paramIdx}
        OR p.country       ILIKE $${paramIdx}
      )`);
      paramIdx++;
    }

    // ── Person JOIN — handles BOTH "my photos" (selfFilter) and named people
    //
    // Strategy:
    //   selfFilter=true  → JOIN on the logged-in user's own "me" person record
    //                       (the person they tagged themselves as)
    //   peopleFilter=[x] → JOIN on the named person's record
    //   both             → both JOINs with AND logic
    //
    // We use INNER JOINs so only photos linked to the correct person pass through.
    // Multiple JOINs = AND (photo must feature ALL listed people).

    let joinClauses = "";

    if (intent.selfFilter) {
      // Find the person record the user tagged themselves as.
      // Convention: we look for a person named "me", "myself", or the user's
      // own display name. Fallback: any person record for this user whose
      // name matches the session username / display name.
      // We do this in SQL with a subquery so it works even if the name varies.
      joinClauses += `
        JOIN photo_people pp_self  ON pp_self.photo_id  = p.id
        JOIN people       per_self ON per_self.id        = pp_self.person_id
                                  AND per_self.username  = $1
                                  AND (
                                    per_self.is_self = true
                                    OR per_self.name ILIKE 'me'
                                    OR per_self.name ILIKE 'myself'
                                  )
      `;
      // Note: $1 is already `username` — no new param needed
    }

    if (intent.peopleFilter.length > 0) {
      // One JOIN per named person so all must appear (AND semantics)
      intent.peopleFilter.forEach((name, i) => {
        const alias = `pp_p${i}`;
        const palias = `per_p${i}`;
        joinClauses += `
          JOIN photo_people ${alias}  ON ${alias}.photo_id   = p.id
          JOIN people       ${palias} ON ${palias}.id         = ${alias}.person_id
                                     AND ${palias}.username   = $1
                                     AND ${palias}.name        ILIKE $${paramIdx}
        `;
        values.push(`%${name}%`);
        paramIdx++;
      });
    }

    const whereClause = conditions.join(" AND ");

    // ── Vector search ─────────────────────────────────────────────────────────
    let queryEmbedding = getCached(query);
    if (!queryEmbedding) {
      try {
        const emb = await embedText(intent.semanticQuery);
        queryEmbedding = toSqlVector(emb);
        setCache(query, queryEmbedding);
      } catch (err) {
        console.error("Embedding failed:", err.message);
      }
    }

    let photos = [];

    if (queryEmbedding) {
      const sql = `
        SELECT DISTINCT p.*,
          ROUND(((1 - (p.embedding <=> $${paramIdx}::vector)) * 100)::numeric, 1) AS similarity_pct,
          1 - (p.embedding <=> $${paramIdx}::vector) AS similarity
        FROM photos p
        ${joinClauses}
        WHERE ${whereClause}
          AND p.embedding IS NOT NULL
        ORDER BY similarity DESC
        LIMIT 50
      `;
      values.push(queryEmbedding);
      try {
        const result = await pool.query(sql, values);
        // Only keep results with meaningful similarity — lower threshold when
        // we already have a hard person/self filter because the JOIN already narrows correctly
        const threshold = (intent.selfFilter || intent.peopleFilter.length > 0) ? 0.20 : 0.35;
        photos = result.rows.filter(r => r.similarity >= threshold);
      } catch (err) {
        console.error("Vector search failed:", err.message);
      }
    }

    // ── Text / SQL fallback (no vector match or embedding unavailable) ────────
    if (photos.length === 0) {
      const fallbackSql = `
        SELECT DISTINCT p.*, 0 AS similarity_pct, 0 AS similarity
        FROM photos p
        ${joinClauses}
        WHERE ${whereClause}
        ORDER BY COALESCE(p.date_taken, p.uploaded_at) DESC
        LIMIT 100
      `;
      // Exclude the vector param (last value) — use all params up to but not including it
      const fallbackValues = values.slice(0, queryEmbedding ? values.length - 1 : values.length);
      try {
        const fallbackResult = await pool.query(fallbackSql, fallbackValues);
        // The JOIN already enforces the person filter — no haystack re-filter needed
        photos = fallbackResult.rows;
      } catch (err) {
        console.error("Fallback search failed:", err.message);
      }
    }

    // ── Quality sort ──────────────────────────────────────────────────────────
    if (intent.qualityFilter === "best") {
      const EMOTION_SCORE = {
        happy:5, excited:5, surprised:3, calm:2,
        neutral:1, sad:-3, fearful:-3, angry:-4, disgusted:-4,
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

    // ── Attach people names to each photo for the UI ──────────────────────────
    if (photos.length > 0) {
      const photoIds = photos.map(p => p.id);
      const peopleResult = await pool.query(
        `SELECT pp.photo_id, per.name, pp.confidence
         FROM photo_people pp
         JOIN people per ON per.id = pp.person_id
         WHERE pp.photo_id = ANY($1) AND per.username = $2`,
        [photoIds, username]
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
        selfFilter:    intent.selfFilter,
        locationQuery: intent.locationQuery,
        qualityFilter: intent.qualityFilter,
      },
      count: photos.length,
    });

  } catch (err) {
    console.error("Search error:", err);
    return NextResponse.json({ error: "Search failed", details: err.message }, { status: 500 });
  }
}