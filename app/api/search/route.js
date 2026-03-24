// app/api/search/route.js — uses shared queryParser, fixes date/people/threshold bugs
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { embedTextCached, toSqlVector } from "@/lib/hf";
import { parseQuery } from "@/lib/queryParser";

// ── DELETED: entire inline parseIntent function (~80 lines) — now uses lib/queryParser.js
// ── DELETED: inline embedCache/getCached/setCache — now uses embedTextCached from lib/hf.js

export async function GET(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q")?.trim();
    if (!query) return NextResponse.json({ photos: [], query: "" });

    const username = session.user.username;
    const intent = parseQuery(query); // FIX: was parseIntent(query)

    const conditions = ["p.uploaded_by = $1"];
    const values = [username];
    let paramIdx = 2;

    // FIX: date filter uses COALESCE(date_taken, uploaded_at) so photos without EXIF still match
    if (intent.dateRange) {
      const dr = intent.dateRange;
      if (dr.after) {
        conditions.push(`COALESCE(p.date_taken, p.uploaded_at) >= $${paramIdx++}`);
        values.push(dr.after);
      }
      if (dr.before) {
        conditions.push(`COALESCE(p.date_taken, p.uploaded_at) < $${paramIdx++}`);
        values.push(dr.before);
      }
    }

    // FIX: person filter queries BOTH photo_people AND face_tags via subselect
    let joinClause = "";
    if (intent.peopleFilter.length > 0) {
      joinClause = `
        JOIN people per ON per.username = $1
          AND (
            EXISTS (SELECT 1 FROM photo_people pp WHERE pp.photo_id = p.id AND pp.person_id = per.id)
            OR EXISTS (SELECT 1 FROM face_tags ft WHERE ft.photo_id = p.id AND ft.person_id = per.id)
          )
      `;
      const nameConditions = intent.peopleFilter.map(name => {
        values.push(`%${name}%`);
        return `per.name ILIKE $${paramIdx++}`;
      });
      conditions.push(`(${nameConditions.join(" OR ")})`);
    }

    const whereClause = conditions.join(" AND ");

    // FIX: uses embedTextCached from lib/hf.js instead of inline cache + getEmbedding
    let queryEmbedding = null;
    try {
      const emb = await embedTextCached(intent.semanticQuery);
      queryEmbedding = toSqlVector(emb); // FIX: was embeddingToSql
    } catch (err) {
      console.error("Query embedding failed:", err.message);
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
        // FIX: threshold raised from 0.35 to 0.45; lower when date/person filters active
        const hasExactFilters = intent.hasDateFilter || intent.hasPersonFilter;
        const threshold = hasExactFilters ? 0.25 : 0.40;
        photos = result.rows.filter(r => r.similarity >= threshold);
      } catch (err) {
        console.error("Vector search failed:", err.message);
      }
    }

    if (photos.length === 0) {
      const lowerWords = query.toLowerCase().split(/\s+/).filter(Boolean);
      const fallbackValues = values.slice(0, paramIdx - (queryEmbedding ? 1 : 0));
      const fallbackSql = `
        SELECT DISTINCT p.*, 0 AS similarity_pct, 0 AS similarity
        FROM photos p
        ${joinClause}
        WHERE ${whereClause}
        ORDER BY COALESCE(p.date_taken, p.uploaded_at) DESC
        LIMIT 100
      `;
      try {
        const fallbackResult = await pool.query(fallbackSql, fallbackValues);
        photos = fallbackResult.rows.filter(photo => {
          const haystack = [photo.ai_description || "", photo.filename || "", photo.dominant_emotion || "", photo.camera_make || ""].join(" ").toLowerCase();
          return lowerWords.some(w => haystack.includes(w));
        });
      } catch (err) {
        console.error("Text fallback failed:", err.message);
      }
    }

    if (intent.qualityFilter === "best") {
      photos.sort((a, b) => {
        const score = (p) => {
            let s = (p.similarity || 0) * 5;                          // semantic weight
            if (p.face_count > 0) s += 1.5;                           // has faces
            if (intent.qualityFilter === "best") {
              s += ((p.width || 0) * (p.height || 0)) / 2_000_000;   // resolution bonus
            }

            // Event keyword bonus: if description contains queried event words
              const desc = (p.ai_description || "").toLowerCase();
              for (const kw of (intent.eventKeywords || [])) {
                if (desc.includes(kw)) s += 2;
              }
              return s;
            };
        return score(b) - score(a);
      });
    }

    // FIX: attach people names from BOTH tables
    if (photos.length > 0) {
      const photoIds = photos.map(p => p.id);
      const peopleResult = await pool.query(
        `SELECT DISTINCT sub.photo_id, per.name FROM (
           SELECT photo_id, person_id FROM photo_people WHERE photo_id = ANY($1)
           UNION
           SELECT photo_id, person_id FROM face_tags WHERE photo_id = ANY($1)
         ) sub
         JOIN people per ON per.id = sub.person_id AND per.username = $2`,
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
      photos, query,
      intent: {
        dateRange: intent.dateRange ? { label: intent.dateRange.label } : null,
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