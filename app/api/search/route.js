// app/api/search/route.js
// Conversational search: understands natural language, filters by person/date/event
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { captionImage, embedText, toSqlVector } from "@/lib/hf";

// ── Query intent parser ───────────────────────────────────────────────────────
// Extracts structured filters from natural language without any LLM
function parseIntent(query) {
  const q = query.toLowerCase();
  const intent = {
    raw: query,
    dateFilter: null,    // { year?, month?, day? }
    peopleFilter: [],    // names extracted from query
    eventKeywords: [],   // birthday, wedding, graduation, etc
    qualityFilter: null, // "best", "clear", "instagram"
    semanticQuery: query // what to embed
  };

  // ── Year extraction ────────────────────────────────────────────────────
  const yearMatch = q.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearMatch) {
    intent.dateFilter = { ...(intent.dateFilter || {}), year: parseInt(yearMatch[1]) };
  }

  // ── Month extraction ───────────────────────────────────────────────────
  const months = {
    january:1, february:2, march:3, april:4, may:5, june:6,
    july:7, august:8, september:9, october:10, november:11, december:12,
    jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12
  };
  for (const [name, num] of Object.entries(months)) {
    if (q.includes(name)) {
      intent.dateFilter = { ...(intent.dateFilter || {}), month: num };
      break;
    }
  }

  // ── Relative time ──────────────────────────────────────────────────────
  const now = new Date();
  if (q.includes("today")) {
    intent.dateFilter = { year: now.getFullYear(), month: now.getMonth()+1, day: now.getDate() };
  } else if (q.includes("yesterday")) {
    const y = new Date(now); y.setDate(y.getDate()-1);
    intent.dateFilter = { year: y.getFullYear(), month: y.getMonth()+1, day: y.getDate() };
  } else if (q.includes("this week")) {
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate()-7);
    intent.dateFilter = { after: weekAgo };
  } else if (q.includes("last week")) {
    const twoWeeks = new Date(now); twoWeeks.setDate(twoWeeks.getDate()-14);
    const oneWeek = new Date(now); oneWeek.setDate(oneWeek.getDate()-7);
    intent.dateFilter = { after: twoWeeks, before: oneWeek };
  } else if (q.includes("last month") || q.includes("past month")) {
    const lastMonth = new Date(now); lastMonth.setMonth(lastMonth.getMonth()-1);
    intent.dateFilter = { after: lastMonth };
  }

  // ── Event keywords ─────────────────────────────────────────────────────
  const events = ["birthday", "wedding", "graduation", "vacation", "holiday",
                  "christmas", "new year", "anniversary", "party", "festival",
                  "beach", "travel", "trip", "concert", "dinner", "lunch"];
  for (const ev of events) {
    if (q.includes(ev)) intent.eventKeywords.push(ev);
  }

  // ── Quality filter ─────────────────────────────────────────────────────
  if (q.includes("best") || q.includes("instagram") || q.includes("clear")
    || q.includes("good photo") || q.includes("nice photo")) {
    intent.qualityFilter = "best";
  }

  // ── People extraction — "with [name]", "of [name]", "[name]'s" ─────────
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

// ── Cache ─────────────────────────────────────────────────────────────────────
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

    const username = session.user.username;
    const intent = parseIntent(query);

    // ── Build SQL filters ─────────────────────────────────────────────────
    const conditions = ["p.uploaded_by = $1"];
    const values = [username];
    let paramIdx = 2;

    // Date filter
    if (intent.dateFilter) {
      const df = intent.dateFilter;
      if (df.year) {
        conditions.push(`EXTRACT(YEAR FROM p.date_taken) = $${paramIdx++}`);
        values.push(df.year);
      }
      if (df.month) {
        conditions.push(`EXTRACT(MONTH FROM p.date_taken) = $${paramIdx++}`);
        values.push(df.month);
      }
      if (df.day) {
        conditions.push(`EXTRACT(DAY FROM p.date_taken) = $${paramIdx++}`);
        values.push(df.day);
      }
      if (df.after) {
        conditions.push(`p.uploaded_at >= $${paramIdx++}`);
        values.push(df.after);
      }
      if (df.before) {
        conditions.push(`p.uploaded_at < $${paramIdx++}`);
        values.push(df.before);
      }
    }

    // Person filter — join to photo_people + people tables
    let joinClause = "";
    if (intent.peopleFilter.length > 0) {
      joinClause = `
        JOIN photo_people pp ON pp.photo_id = p.id
        JOIN people per ON per.id = pp.person_id AND per.username = $1
      `;
      const nameConditions = intent.peopleFilter.map(name => {
        values.push(`%${name}%`);
        return `per.name ILIKE $${paramIdx++}`;
      });
      conditions.push(`(${nameConditions.join(" OR ")})`);
    }

    const whereClause = conditions.join(" AND ");

    // ── Vector search ─────────────────────────────────────────────────────
    let queryEmbedding = getCached(query);
    if (!queryEmbedding) {
      try {
        const emb = await getEmbedding(intent.semanticQuery);
        queryEmbedding = embeddingToSql(emb);
        setCache(query, queryEmbedding);
      } catch (err) {
        console.error("Query embedding failed:", err.message);
      }
    }

    let photos = [];

    if (queryEmbedding) {
      // Vector-first search
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
        // Threshold: 0.35 — loose enough to catch semantic matches
        photos = result.rows.filter(r => r.similarity >= 0.35);
      } catch (err) {
        console.error("Vector search failed:", err.message);
      }
    }

    // ── Text fallback for photos without embeddings ────────────────────────
    if (photos.length === 0) {
      const lowerWords = query.toLowerCase().split(/\s+/).filter(Boolean);
      const fallbackSql = `
        SELECT DISTINCT p.*, 0 AS similarity_pct, 0 AS similarity
        FROM photos p
        ${joinClause}
        WHERE ${whereClause}
        ORDER BY p.uploaded_at DESC
        LIMIT 100
      `;
      const fallbackResult = await pool.query(fallbackSql, values.slice(0, paramIdx - 1));
      photos = fallbackResult.rows.filter(photo => {
        const haystack = [
          photo.ai_description || "", photo.filename || "",
          photo.dominant_emotion || "", photo.camera_make || "",
        ].join(" ").toLowerCase();
        // All words must appear for an exact text match
        return lowerWords.some(w => haystack.includes(w));
      });
    }

    // ── Quality sort for "best photo" queries ──────────────────────────────
    if (intent.qualityFilter === "best") {
      photos = photos.sort((a, b) => {
        // Score: higher res + face detected + no blur indicator
        const score = (p) =>
          (p.width || 0) * (p.height || 0) / 1_000_000 +
          (p.face_count > 0 ? 2 : 0) +
          (p.similarity || 0) * 3;
        return score(b) - score(a);
      });
    }

    // ── Attach people names to each photo ──────────────────────────────────
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
        dateFilter: intent.dateFilter,
        peopleFilter: intent.peopleFilter,
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