// lib/assistant/tools.js
// All tool definitions (for OpenAI function calling) + executors (actual DB logic)
// Every executor receives (params, username) — username is always the authenticated user,
// the LLM cannot override it.

import pool from "@/lib/db";
import { embedText, toSqlVector } from "@/lib/hf";


export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_photos",
      description:
        "Search the user's photo library using natural language. Returns matching photos with URLs and descriptions. Use for any query about finding photos: by date, person, place, event, emotion, or topic.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language search query, e.g. 'birthday party 2024' or 'photos with Gautam at the beach'",
          },
          limit: {
            type: "number",
            description: "Max photos to return (default 20, max 50)",
          },
          scope: {
            type: "string",
            enum: ["mine", "family"],
            description: "Search only the user's photos (mine) or all family/shared album members' photos (family). Default: mine",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_timeline",
      description:
        "Get the user's photo timeline grouped by time period. Returns life chapters / periods. Use for questions like 'what have I been up to?' or 'tell me about my year' or 'what was my life like in 2023'.",
      parameters: {
        type: "object",
        properties: {
          year: {
            type: "number",
            description: "Filter to a specific year, e.g. 2024",
          },
          group_by: {
            type: "string",
            enum: ["month", "quarter", "year"],
            description: "How to group photos. Default: month",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_life_chapters",
      description:
        "Identify meaningful life chapters or periods from the user's photo history. Uses AI to cluster photos into named narrative periods like 'The Barcelona summer', 'Life in Austin', 'Year of weddings'. Use when the user asks about their life story, chapters, or significant periods.",
      parameters: {
        type: "object",
        properties: {
          from_date: { type: "string", description: "ISO date string, e.g. '2022-01-01'" },
          to_date: { type: "string", description: "ISO date string, e.g. '2024-12-31'" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_album",
      description:
        "Create a new album, optionally with photos already in it. Use when the user asks to create, make, or start an album.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Album name" },
          description: { type: "string", description: "Optional album description" },
          photo_ids: {
            type: "array",
            items: { type: "number" },
            description: "Optional array of photo IDs to add immediately",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "share_album",
      description:
        "Share an existing album with another user by their username. Use when the user asks to share an album.",
      parameters: {
        type: "object",
        properties: {
          album_id: { type: "number", description: "ID of the album to share" },
          username: { type: "string", description: "Username of the person to share with" },
        },
        required: ["album_id", "username"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_people_stats",
      description:
        "Get stats about people tagged in the user's photos — who appears most often, with whom, etc. Use for questions like 'who do I take the most photos with?' or 'show me photos of [name]'.",
      parameters: {
        type: "object",
        properties: {
          person_name: {
            type: "string",
            description: "Optional: filter to a specific person's name",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_year_in_review",
      description:
        "Generate a narrative year-in-review for the user based on all their photos from that year. Returns a written story plus key photos. Use when the user asks for a year recap, year in review, or 'tell me about my [year]'.",
      parameters: {
        type: "object",
        properties: {
          year: { type: "number", description: "The year to review, e.g. 2024" },
          include_family: {
            type: "boolean",
            description: "Include photos from shared family albums too",
          },
        },
        required: ["year"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_duplicates",
      description:
        "Find duplicate or near-duplicate photos in the user's library. Returns groups of similar photos.",
      parameters: {
        type: "object",
        properties: {
          threshold: {
            type: "number",
            description: "Similarity threshold 0-1 (default 0.95). Higher = more exact matches only.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_photos",
      description:
        "Delete photos by their IDs. ALWAYS confirm with the user before calling this. Only call after explicit user confirmation.",
      parameters: {
        type: "object",
        properties: {
          photo_ids: {
            type: "array",
            items: { type: "number" },
            description: "Array of photo IDs to delete",
          },
        },
        required: ["photo_ids"],
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TOOL EXECUTORS
// ─────────────────────────────────────────────────────────────────────────────

// Shared: run vector search against the DB
async function vectorSearch(query, username, limit = 20, extraJoin = "", extraWhere = "") {
  let embedding = null;
  try {
    const vec = await embedText(query);
    embedding = toSqlVector(vec);
  } catch {}

  if (embedding) {
    const sql = `
      SELECT DISTINCT ON (p.id)
        p.id, p.url, p.filename, p.ai_description,
        p.date_taken, p.uploaded_at, p.place_name, p.dominant_emotion,
        p.face_count, p.uploaded_by,
        ROUND(((1 - (p.embedding <=> $2::vector)) * 100)::numeric, 1) AS similarity_pct,
        (p.embedding <=> $2::vector) AS _dist
      FROM photos p
      ${extraJoin}
      WHERE (p.uploaded_by = $1 ${extraWhere})
        AND p.embedding IS NOT NULL
      ORDER BY p.id, _dist
      LIMIT $3
    `;
    const result = await pool.query(sql, [username, embedding, limit]);
    const threshold = extraWhere ? 0.2 : 0.35;
    // Re-sort by similarity after dedup since DISTINCT ON forces order by id first
    return result.rows
      .filter(r => r.similarity_pct / 100 >= threshold)
      .sort((a, b) => a._dist - b._dist);
  }

  // Text fallback
  const words = query.toLowerCase().split(/\s+/);
  const sql = `
    SELECT DISTINCT ON (p.id)
      p.id, p.url, p.filename, p.ai_description,
      p.date_taken, p.uploaded_at, p.place_name, p.dominant_emotion,
      p.face_count, p.uploaded_by, 0 AS similarity_pct
    FROM photos p
    ${extraJoin}
    WHERE (p.uploaded_by = $1 ${extraWhere})
    ORDER BY p.id, COALESCE(p.date_taken, p.uploaded_at) DESC
    LIMIT $2
  `;
  const result = await pool.query(sql, [username, limit]);
  return result.rows.filter(p => {
    const hay = [p.ai_description, p.filename, p.place_name, p.dominant_emotion]
      .filter(Boolean).join(" ").toLowerCase();
    return words.some(w => hay.includes(w));
  });
}

// ── search_photos ─────────────────────────────────────────────────────────────
export async function executeSearchPhotos({ query, limit = 20, scope = "mine" }, username) {
  const cap = Math.min(limit, 50);
  const q = query.toLowerCase();

  // ── Detect "photos with [person]" queries ─────────────────────────────────
  const FAMILY_KEYWORDS = ['mom','mother','mama','mum','dad','father','papa','sister','sis',
    'brother','bro','wife','husband','son','daughter','grandma','grandpa',
    'grandmother','grandfather','aunt','uncle','cousin','family'];
  const isFamilyQuery = FAMILY_KEYWORDS.some(k => q.includes(k));

  // Extract person name — "photos with X", "my photos with X", "show me X", "X photos"
  const withPatterns = [
    /(?:my\s+)?photos?\s+with\s+([a-z][a-z\s]{1,25}?)(?:\s*$|\s+(?:at|in|from|last|this|today|and))/i,
    /(?:show\s+me\s+)?(?:me\s+and\s+|with\s+)([a-z][a-z\s]{1,25}?)(?:\s*$|\s+(?:at|in|from))/i,
    /(?:me\s+and\s+)([a-z][a-z\s]{1,25}?)(?:\s*$)/i,
    /(?:get\s+me\s+)?(?:my\s+)?photos?\s+with\s+([a-z][a-z\s]{1,25}?)(?:\s*$)/i,
  ];

  let nameGuess = null;
  for (const pattern of withPatterns) {
    const m = q.match(pattern);
    if (m?.[1]?.trim().length > 1) {
      nameGuess = m[1].trim();
      break;
    }
  }

  // ── Resolve to tagged people ──────────────────────────────────────────────
  let resolvedPeople = [];

  if (isFamilyQuery) {
    const conditions = FAMILY_KEYWORDS.map((_, i) => `name ILIKE $${i + 2}`).join(' OR ');
    const res = await pool.query(
      `SELECT id, name FROM people WHERE username = $1 AND (${conditions})`,
      [username, ...FAMILY_KEYWORDS.map(k => `%${k}%`)]
    );
    resolvedPeople = res.rows;
  } else if (nameGuess) {
    const res = await pool.query(
      `SELECT id, name FROM people WHERE username = $1 AND name ILIKE $2`,
      [username, `%${nameGuess}%`]
    );
    resolvedPeople = res.rows;
  }

  // ── Person-based search ───────────────────────────────────────────────────
  if (resolvedPeople.length > 0) {
    const personIds = resolvedPeople.map(p => p.id);
    const idPlaceholders = personIds.map((_, i) => `$${i + 2}`).join(', ');

    // Find "me" — the person the user tagged as themselves.
    // Check multiple common self-tag names: "me", "myself", or the username itself.
    const meRes = await pool.query(
      `SELECT id, name FROM people
       WHERE username = $1
         AND (
           name ILIKE 'me'
           OR name ILIKE 'myself'
           OR name ILIKE $2
         )
       LIMIT 1`,
      [username, username]
    );
    const meId = meRes.rows[0]?.id;

    // Helper: checks both photo_people and face_tags for a person in a photo
    const taggedInPhoto = (alias, personParam) => `
      (
        EXISTS (
          SELECT 1 FROM photo_people ${alias}pp
          WHERE ${alias}pp.photo_id = p.id AND ${alias}pp.person_id = ${personParam}
        ) OR EXISTS (
          SELECT 1 FROM face_tags ${alias}ft
          WHERE ${alias}ft.photo_id = p.id AND ${alias}ft.person_id = ${personParam}
        )
      )
    `;

    // If we know "me" and they're not the one being searched for,
    // require BOTH me AND the named person in the same photo
    if (meId && !personIds.includes(meId)) {
      const meParam = `$${personIds.length + 2}`;

      const result = await pool.query(
        `SELECT DISTINCT ON (p.id)
                p.id, p.url, p.filename, p.ai_description,
                p.date_taken, p.uploaded_at, p.place_name, p.dominant_emotion,
                p.face_count, p.uploaded_by, 0 AS similarity_pct,
                COALESCE(p.date_taken, p.uploaded_at) AS _sort
         FROM photos p
         WHERE p.uploaded_by = $1
           AND (
             EXISTS (
               SELECT 1 FROM photo_people pp
               WHERE pp.photo_id = p.id AND pp.person_id IN (${idPlaceholders})
             ) OR EXISTS (
               SELECT 1 FROM face_tags ft
               WHERE ft.photo_id = p.id AND ft.person_id IN (${idPlaceholders})
             )
           )
           AND (
             EXISTS (
               SELECT 1 FROM photo_people pp2
               WHERE pp2.photo_id = p.id AND pp2.person_id = ${meParam}
             ) OR EXISTS (
               SELECT 1 FROM face_tags ft2
               WHERE ft2.photo_id = p.id AND ft2.person_id = ${meParam}
             )
           )
         ORDER BY p.id, COALESCE(p.date_taken, p.uploaded_at) DESC
         LIMIT $${personIds.length + 3}`,
        [username, ...personIds, meId, cap]
      );

      result.rows.sort((a, b) => new Date(b._sort) - new Date(a._sort));

      if (result.rows.length === 0) {
        // Debug: check if either person has any tags at all
    const yashuCheck = await pool.query(
  `SELECT COUNT(*) FROM (
     SELECT photo_id FROM photo_people WHERE person_id = ANY($1::int[])
     UNION
     SELECT photo_id FROM face_tags WHERE person_id = ANY($1::int[])
   ) x`,
  [personIds]
);
const meCheck = await pool.query(
  `SELECT COUNT(*) FROM (
     SELECT photo_id FROM photo_people WHERE person_id = $1
     UNION
     SELECT photo_id FROM face_tags WHERE person_id = $1
   ) x`,
  [meId]
);
        const yashuCount = parseInt(yashuCheck.rows[0].count);
        const meCount = parseInt(meCheck.rows[0].count);

        return {
          photos: [],
          count: 0,
          query,
          resolved_people: resolvedPeople.map(p => p.name),
          no_together_message: yashuCount === 0
            ? `I couldn't find any photos with ${resolvedPeople.map(p => p.name).join(', ')} tagged in your library.`
            : meCount === 0
            ? `I found ${yashuCount} photo${yashuCount !== 1 ? 's' : ''} of ${resolvedPeople.map(p => p.name).join(', ')}, but you haven't tagged yourself in any photos yet. Tag your own face on the People page so I can find photos of you together.`
            : `I found photos of ${resolvedPeople.map(p => p.name).join(', ')} (${yashuCount} photos) and photos of you (${meCount} photos), but none where you're both tagged in the same photo.`,
        };
      }

      return {
        photos: result.rows,
        count: result.rows.length,
        query,
        resolved_people: resolvedPeople.map(p => p.name),
      };
    }

    // No "me" tag found — return all photos of the named person
    const result = await pool.query(
      `SELECT DISTINCT ON (p.id)
              p.id, p.url, p.filename, p.ai_description,
              p.date_taken, p.uploaded_at, p.place_name, p.dominant_emotion,
              p.face_count, p.uploaded_by, 0 AS similarity_pct,
              COALESCE(p.date_taken, p.uploaded_at) AS _sort
       FROM photos p
       WHERE p.uploaded_by = $1
         AND (
           EXISTS (
             SELECT 1 FROM photo_people pp
             WHERE pp.photo_id = p.id AND pp.person_id IN (${idPlaceholders})
           ) OR EXISTS (
             SELECT 1 FROM face_tags ft
             WHERE ft.photo_id = p.id AND ft.person_id IN (${idPlaceholders})
           )
         )
       ORDER BY p.id, COALESCE(p.date_taken, p.uploaded_at) DESC
       LIMIT $${personIds.length + 2}`,
      [username, ...personIds, cap]
    );

    result.rows.sort((a, b) => new Date(b._sort) - new Date(a._sort));

    return {
      photos: result.rows,
      count: result.rows.length,
      query,
      resolved_people: resolvedPeople.map(p => p.name),
      no_me_tag_message: `Showing all photos of ${resolvedPeople.map(p => p.name).join(', ')}. To see only photos where you're together, tag your own face as "Me" on the People page.`,
    };
  }

  // ── Default: vector search ────────────────────────────────────────────────
  let extraJoin = "";
  let extraWhere = "";
  if (scope === "family") {
    extraJoin = `
      LEFT JOIN album_photos ap ON ap.photo_id = p.id
      LEFT JOIN album_members am ON am.album_id = ap.album_id AND am.username = '${username}'
    `;
    extraWhere = `OR (am.username IS NOT NULL AND p.uploaded_by != '${username}')`;
  }

  const photos = await vectorSearch(query, username, cap, extraJoin, extraWhere);
  return { photos: photos.slice(0, cap), count: photos.length, query };
}

// ── get_timeline ──────────────────────────────────────────────────────────────
export async function executeGetTimeline({ year, group_by = "month" }, username) {
  let groupExpr, labelExpr;
  if (group_by === "year") {
    groupExpr = "EXTRACT(YEAR FROM COALESCE(date_taken, uploaded_at))::int";
    labelExpr = groupExpr;
  } else if (group_by === "quarter") {
    groupExpr = "TO_CHAR(COALESCE(date_taken, uploaded_at), 'YYYY-Q')";
    labelExpr = groupExpr;
  } else {
    groupExpr = "TO_CHAR(COALESCE(date_taken, uploaded_at), 'YYYY-MM')";
    labelExpr = "TO_CHAR(COALESCE(date_taken, uploaded_at), 'Month YYYY')";
  }

  const conditions = ["uploaded_by = $1"];
  const values = [username];
  if (year) {
    conditions.push(`EXTRACT(YEAR FROM COALESCE(date_taken, uploaded_at)) = $2`);
    values.push(year);
  }

  const sql = `
    SELECT
      ${groupExpr} AS period_key,
      ${labelExpr} AS period_label,
      COUNT(*) AS photo_count,
      MIN(COALESCE(date_taken, uploaded_at)) AS period_start,
      MAX(COALESCE(date_taken, uploaded_at)) AS period_end,
      MODE() WITHIN GROUP (ORDER BY dominant_emotion) AS mood,
      ARRAY_AGG(place_name ORDER BY COALESCE(date_taken, uploaded_at)) FILTER (WHERE place_name IS NOT NULL) AS places,
      (ARRAY_AGG(url ORDER BY COALESCE(date_taken, uploaded_at) DESC))[1] AS cover_url
    FROM photos
    WHERE ${conditions.join(" AND ")}
    GROUP BY period_key, period_label
    ORDER BY period_key DESC
    LIMIT 24
  `;

  const result = await pool.query(sql, values);

  return {
    periods: result.rows.map(r => ({
      ...r,
      places: [...new Set((r.places || []).filter(Boolean))].slice(0, 3),
    })),
  };
}

// ── get_life_chapters ─────────────────────────────────────────────────────────
export async function executeGetLifeChapters({ from_date, to_date }, username) {
  // Pull all photo descriptions in chronological order
  const conditions = ["uploaded_by = $1", "ai_description IS NOT NULL"];
  const values = [username];
  if (from_date) { conditions.push(`COALESCE(date_taken, uploaded_at) >= $${values.length + 1}`); values.push(from_date); }
  if (to_date)   { conditions.push(`COALESCE(date_taken, uploaded_at) <= $${values.length + 1}`); values.push(to_date); }

  const result = await pool.query(
    `SELECT id, url, ai_description, place_name,
       TO_CHAR(COALESCE(date_taken, uploaded_at), 'Mon YYYY') AS month_label,
       COALESCE(date_taken, uploaded_at) AS taken_at
     FROM photos
     WHERE ${conditions.join(" AND ")}
     ORDER BY taken_at ASC
     LIMIT 200`,
    values
  );

  if (result.rows.length === 0) {
    return { chapters: [], message: "No photos with descriptions found." };
  }

  // Build a compact summary for GPT-4o
  const photoSummary = result.rows
    .map(r => `[${r.month_label}${r.place_name ? ` · ${r.place_name}` : ""}] ${r.ai_description}`)
    .join("\n");

  const apiKey = process.env.OPENAI_API_KEY;
  const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 1000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You identify meaningful life chapters from photo descriptions. 
Return JSON: { "chapters": [ { "title": "...", "date_range": "...", "description": "2-3 sentence narrative", "mood": "...", "key_places": [...] } ] }
Create 3-8 chapters. Give each a poetic, specific title like "The Barcelona summer" or "When everything changed" — not generic like "2023 photos".`,
        },
        { role: "user", content: `Here are my photos in order:\n\n${photoSummary}` },
      ],
    }),
  });

  const gptData = await gptRes.json();
  let chapters = [];
  try {
    const parsed = JSON.parse(gptData.choices[0].message.content);
    chapters = parsed.chapters || [];
  } catch {}

  // Attach a cover photo to each chapter by searching for matching descriptions
  const photosWithUrls = result.rows;
  const chaptersWithPhotos = chapters.map(ch => {
    const cover = photosWithUrls.find(p => {
      const label = p.month_label?.toLowerCase() || "";
      return ch.date_range?.toLowerCase().includes(label.split(" ")[1]) ||
             (ch.key_places || []).some(pl => p.place_name?.toLowerCase().includes(pl.toLowerCase()));
    });
    return { ...ch, cover_url: cover?.url || photosWithUrls[0]?.url };
  });

  return { chapters: chaptersWithPhotos };
}

// ── create_album ──────────────────────────────────────────────────────────────
export async function executeCreateAlbum({ name, description = "", photo_ids = [] }, username) {
  // Get user id
  const userRes = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
  const userId = userRes.rows[0]?.id;

  const albumRes = await pool.query(
    `INSERT INTO albums (name, description, created_by, user_id) VALUES ($1, $2, $3, $4) RETURNING id, name`,
    [name, description, username, userId]
  );
  const album = albumRes.rows[0];

  // Also insert owner into album_members
  await pool.query(
    `INSERT INTO album_members (album_id, username, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
    [album.id, username]
  );

  // Add photos if provided
  if (photo_ids.length > 0) {
    for (const pid of photo_ids) {
      await pool.query(
        `INSERT INTO album_photos (album_id, photo_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [album.id, pid, username]
      );
    }
  }

  return {
    album_id: album.id,
    name: album.name,
    photos_added: photo_ids.length,
    message: `Created album "${album.name}"${photo_ids.length ? ` with ${photo_ids.length} photos` : ""}`,
  };
}

// ── share_album ───────────────────────────────────────────────────────────────
export async function executeShareAlbum({ album_id, username: targetUser }, username) {
  if (targetUser === username) return { error: "Cannot share with yourself" };

  // Verify ownership
  const ownerCheck = await pool.query(
    "SELECT id FROM albums WHERE id = $1 AND created_by = $2",
    [album_id, username]
  );
  if (!ownerCheck.rows.length) return { error: "Album not found or you don't own it" };

  // Check target user exists
  const userCheck = await pool.query("SELECT id FROM users WHERE username = $1", [targetUser]);
  if (!userCheck.rows.length) return { error: `User "${targetUser}" not found` };

  await pool.query(
    `INSERT INTO shared_albums (album_id, shared_by, shared_with) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [album_id, username, targetUser]
  );
  await pool.query(
    `INSERT INTO album_members (album_id, username, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
    [album_id, targetUser]
  );

  return { message: `Shared album with @${targetUser}` };
}

// ── get_people_stats ──────────────────────────────────────────────────────────
export async function executeGetPeopleStats({ person_name }, username) {
  if (person_name) {
    const result = await pool.query(
      `SELECT p.id, p.url, p.ai_description, p.date_taken, p.uploaded_at, p.place_name
       FROM photos p
       JOIN photo_people pp ON pp.photo_id = p.id
       JOIN people per ON per.id = pp.person_id AND per.username = $1
       WHERE p.uploaded_by = $1 AND per.name ILIKE $2
       ORDER BY COALESCE(p.date_taken, p.uploaded_at) DESC
       LIMIT 30`,
      [username, `%${person_name}%`]
    );
    return { photos: result.rows, person: person_name, count: result.rows.length };
  }

  // Find photos that have 2+ tagged people (group shots / together photos)
  // Then count how often each person co-appears with anyone else in those photos
  const people = await pool.query(
    `SELECT per.id, per.name, COUNT(DISTINCT p.id) AS photo_count
     FROM photos p
     -- photo must have at least 2 tagged people
     JOIN (
       SELECT photo_id
       FROM photo_people pp2
       JOIN people per2 ON per2.id = pp2.person_id AND per2.username = $1
       GROUP BY photo_id
       HAVING COUNT(DISTINCT pp2.person_id) >= 2
     ) multi ON multi.photo_id = p.id
     -- join to get each person in those photos
     JOIN photo_people pp ON pp.photo_id = p.id
     JOIN people per ON per.id = pp.person_id AND per.username = $1
     WHERE p.uploaded_by = $1
     GROUP BY per.id, per.name
     ORDER BY photo_count DESC
     LIMIT 10`,
    [username]
  );

  if (!people.rows.length) {
    return {
      people: [],
      message: "No group photos found yet. Tag people in your photos to see who you spend time with.",
    };
  }

  // For each person, fetch their shared photos (photos where they appear with someone else)
  const peopleWithPhotos = await Promise.all(
    people.rows.map(async (person) => {
      const photos = await pool.query(
        `SELECT p.id, p.url, p.ai_description, p.place_name,
                COALESCE(p.date_taken, p.uploaded_at) AS taken_at
         FROM photos p
         JOIN photo_people pp ON pp.photo_id = p.id AND pp.person_id = $1
         WHERE p.uploaded_by = $2
           AND p.id IN (
             SELECT photo_id FROM photo_people pp3
             JOIN people per3 ON per3.id = pp3.person_id AND per3.username = $2
             GROUP BY photo_id
             HAVING COUNT(DISTINCT pp3.person_id) >= 2
           )
         ORDER BY taken_at DESC
         LIMIT 3`,
        [person.id, username]
      );
      return { ...person, photos: photos.rows };
    })
  );

  return { people: peopleWithPhotos };
}

// ── generate_year_in_review ───────────────────────────────────────────────────
export async function executeGenerateYearInReview({ year, include_family = false }, username) {
  let joinClause = "";
  let whereExtra = "";
  if (include_family) {
    joinClause = `
      LEFT JOIN album_photos ap ON ap.photo_id = p.id
      LEFT JOIN album_members am ON am.album_id = ap.album_id AND am.username = '${username}'
    `;
    whereExtra = `OR (am.username IS NOT NULL AND p.uploaded_by != '${username}')`;
  }

  const result = await pool.query(
    `SELECT p.id, p.url, p.ai_description, p.place_name, p.dominant_emotion,
       TO_CHAR(COALESCE(p.date_taken, p.uploaded_at), 'Month') AS month_name,
       EXTRACT(MONTH FROM COALESCE(p.date_taken, p.uploaded_at))::int AS month_num
     FROM photos p
     ${joinClause}
     WHERE (p.uploaded_by = $1 ${whereExtra})
       AND EXTRACT(YEAR FROM COALESCE(p.date_taken, p.uploaded_at)) = $2
       AND p.ai_description IS NOT NULL
     ORDER BY COALESCE(p.date_taken, p.uploaded_at)`,
    [username, year]
  );

  if (result.rows.length === 0) {
    return { narrative: `No photos found for ${year}.`, photos: [], year };
  }

  const summary = result.rows
    .map(r => `[${r.month_name}${r.place_name ? ` · ${r.place_name}` : ""}] ${r.ai_description}`)
    .join("\n");

  const apiKey = process.env.OPENAI_API_KEY;
  const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 800,
      messages: [
        {
          role: "system",
          content: `You write beautiful, personal year-in-review narratives from photo descriptions. 
Write 3-4 paragraphs in second person ("You started the year...", "By summer, you were..."). 
Be specific, warm, and evocative. Reference real places and moments from the photos. 
This should feel like a letter from a close friend who watched your year unfold.`,
        },
        { role: "user", content: `Write a year in review for ${year}:\n\n${summary}` },
      ],
    }),
  });
  const gptData = await gptRes.json();
  const narrative = gptData.choices?.[0]?.message?.content || "Could not generate narrative.";

  // Pick highlight photos (one per quarter)
  const highlights = [3, 6, 9, 12].map(m => {
    const month = result.rows.filter(r => r.month_num <= m && r.month_num > m - 3);
    return month[Math.floor(month.length / 2)] || null;
  }).filter(Boolean);

  return { narrative, photos: highlights, year, total_photos: result.rows.length };
}

// ── find_duplicates ───────────────────────────────────────────────────────────
export async function executeFindDuplicates({ threshold = 0.95 }, username) {
  const result = await pool.query(
    `SELECT id, url, filename, embedding, ai_description
     FROM photos WHERE uploaded_by = $1 AND embedding IS NOT NULL`,
    [username]
  );
  const photos = result.rows;
  const groups = [];
  const seen = new Set();

  for (let i = 0; i < photos.length; i++) {
    if (seen.has(photos[i].id)) continue;
    const group = [photos[i]];
    for (let j = i + 1; j < photos.length; j++) {
      if (seen.has(photos[j].id)) continue;
      // Cosine similarity via dot product (embeddings stored as strings)
      try {
        const a = photos[i].embedding.replace(/[\[\]]/g, "").split(",").map(Number);
        const b = photos[j].embedding.replace(/[\[\]]/g, "").split(",").map(Number);
        let dot = 0, na = 0, nb = 0;
        for (let k = 0; k < a.length; k++) { dot += a[k] * b[k]; na += a[k] ** 2; nb += b[k] ** 2; }
        const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
        if (sim >= threshold) { group.push(photos[j]); seen.add(photos[j].id); }
      } catch {}
    }
    if (group.length > 1) {
      seen.add(photos[i].id);
      groups.push(group.map(p => ({ id: p.id, url: p.url, filename: p.filename })));
    }
  }

  return { duplicate_groups: groups, group_count: groups.length };
}

// ── delete_photos ─────────────────────────────────────────────────────────────
export async function executeDeletePhotos({ photo_ids }, username) {
  // Ownership check — only delete photos owned by this user
  const placeholders = photo_ids.map((_, i) => `$${i + 1}`).join(", ");
  const check = await pool.query(
    `SELECT id FROM photos WHERE id IN (${placeholders}) AND uploaded_by = $${photo_ids.length + 1}`,
    [...photo_ids, username]
  );
  const ownedIds = check.rows.map(r => r.id);

  if (ownedIds.length === 0) return { deleted: 0, message: "No photos found to delete." };

  // Try storage cleanup (best-effort)
  try {
    const paths = await pool.query(
      `SELECT storage_path FROM photos WHERE id IN (${placeholders}) AND uploaded_by = $${photo_ids.length + 1}`,
      [...photo_ids, username]
    );
    const storagePaths = paths.rows.map(r => r.storage_path).filter(Boolean);
    if (storagePaths.length) {
      const { default: supabaseAdmin } = await import("@/lib/supabaseAdmin");
      if (supabaseAdmin?.storage) {
        await supabaseAdmin.storage.from("photos").remove(storagePaths);
      }
    }
  } catch {}

  const ownedPlaceholders = ownedIds.map((_, i) => `$${i + 1}`).join(", ");
  await pool.query(
    `DELETE FROM photos WHERE id IN (${ownedPlaceholders}) AND uploaded_by = $${ownedIds.length + 1}`,
    [...ownedIds, username]
  );

  return { deleted: ownedIds.length, message: `Deleted ${ownedIds.length} photo${ownedIds.length !== 1 ? "s" : ""}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPATCHER  — routes tool name → executor
// ─────────────────────────────────────────────────────────────────────────────

export async function executeTool(toolName, params, username) {
  switch (toolName) {
    case "search_photos":          return executeSearchPhotos(params, username);
    case "get_timeline":           return executeGetTimeline(params, username);
    case "get_life_chapters":      return executeGetLifeChapters(params, username);
    case "create_album":           return executeCreateAlbum(params, username);
    case "share_album":            return executeShareAlbum(params, username);
    case "get_people_stats":       return executeGetPeopleStats(params, username);
    case "generate_year_in_review":return executeGenerateYearInReview(params, username);
    case "find_duplicates":        return executeFindDuplicates(params, username);
    case "delete_photos":          return executeDeletePhotos(params, username);
    default: return { error: `Unknown tool: ${toolName}` };
  }
}