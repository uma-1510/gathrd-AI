// lib/agent/executor.js
// Pure functions. Each receives (params, context) and returns a plain object.
// context = { username, pool, supabaseAdmin }
// Never throws — always returns { error } on failure so the LLM can reason about it.

import { embedText, toSqlVector } from "@/lib/hf";

// ─── search_photos ────────────────────────────────────────────────────────────
export async function search_photos(params, { username, pool }) {
  try {
    const conditions = ["p.uploaded_by = $1"];
    const values = [username];
    let idx = 2;

    if (params.location) {
      conditions.push(`(p.place_name ILIKE $${idx} OR p.ai_description ILIKE $${idx})`);
      values.push(`%${params.location}%`);
      idx++;
    }

    if (params.person_name) {
      conditions.push(`
        EXISTS (
          SELECT 1 FROM photo_people pp
          JOIN people per ON per.id = pp.person_id
          WHERE pp.photo_id = p.id
            AND per.name ILIKE $${idx}
            AND per.username = $1
        )
      `);
      values.push(`%${params.person_name}%`);
      idx++;
    }

    if (params.days_ago) {
      conditions.push(
        `COALESCE(p.date_taken, p.uploaded_at) >= NOW() - INTERVAL '${parseInt(params.days_ago)} days'`
      );
    }

    if (params.date_from) {
      conditions.push(`COALESCE(p.date_taken, p.uploaded_at) >= $${idx++}`);
      values.push(params.date_from);
    }

    if (params.date_to) {
      conditions.push(`COALESCE(p.date_taken, p.uploaded_at) <= $${idx++}`);
      values.push(params.date_to);
    }

    const limit = Math.min(params.limit || 100, 200);

    // Semantic vector search if description provided
    if (params.semantic) {
      try {
        const vec = await embedText(params.semantic);
        const sql = `
          SELECT DISTINCT p.id, p.url, p.filename, p.place_name,
                 p.date_taken, p.dominant_emotion, p.face_count,
                 p.ai_description, p.uploaded_by,
                 ROUND(((1 - (p.embedding <=> $${idx}::vector)) * 100)::numeric, 1) AS match_pct
          FROM photos p
          WHERE ${conditions.join(" AND ")} AND p.embedding IS NOT NULL
          ORDER BY p.embedding <=> $${idx}::vector
          LIMIT $${idx + 1}
        `;
        values.push(toSqlVector(vec), limit);
        const res = await pool.query(sql, values);
        return { count: res.rows.length, photos: res.rows };
      } catch {
        // Fall through to non-semantic query
      }
    }

    const res = await pool.query(
      `SELECT p.id, p.url, p.filename, p.place_name,
              p.date_taken, p.dominant_emotion, p.face_count,
              p.ai_description, p.uploaded_by
       FROM photos p
       WHERE ${conditions.join(" AND ")}
       ORDER BY COALESCE(p.date_taken, p.uploaded_at) DESC
       LIMIT $${idx}`,
      [...values, limit]
    );

    return { count: res.rows.length, photos: res.rows };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── get_album ────────────────────────────────────────────────────────────────
export async function get_album(params, { username, pool }) {
  try {
    const accessClause = `
      (a.created_by = $1
       OR EXISTS (SELECT 1 FROM shared_albums sa WHERE sa.album_id = a.id AND sa.shared_with = $1)
       OR EXISTS (SELECT 1 FROM album_members am WHERE am.album_id = a.id AND am.username = $1))
    `;

    let albumRow;
    if (params.album_id) {
      const r = await pool.query(
        `SELECT a.* FROM albums a WHERE a.id = $2 AND ${accessClause}`,
        [username, params.album_id]
      );
      albumRow = r.rows[0];
    } else if (params.album_name) {
      const r = await pool.query(
        `SELECT a.* FROM albums a WHERE a.name ILIKE $2 AND ${accessClause} LIMIT 1`,
        [username, `%${params.album_name}%`]
      );
      albumRow = r.rows[0];
    }

    if (!albumRow) return { error: "Album not found or no access" };

    const [photos, members] = await Promise.all([
      pool.query(
        `SELECT p.id, p.url, p.filename, p.uploaded_by, p.date_taken,
                p.dominant_emotion, p.face_count, p.ai_description,
                ap.added_by
         FROM album_photos ap
         JOIN photos p ON p.id = ap.photo_id
         WHERE ap.album_id = $1
         ORDER BY COALESCE(p.date_taken, p.uploaded_at) DESC`,
        [albumRow.id]
      ),
      pool.query(
        `SELECT username, role FROM album_members WHERE album_id = $1 ORDER BY role`,
        [albumRow.id]
      ),
    ]);

    return {
      album_id:     albumRow.id,
      album_name:   albumRow.name,
      created_by:   albumRow.created_by,
      is_owner:     albumRow.created_by === username,
      member_count: members.rows.length,
      members:      members.rows,
      photo_count:  photos.rows.length,
      photos:       photos.rows,
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── list_albums ──────────────────────────────────────────────────────────────
export async function list_albums(params, { username, pool }) {
  try {
    const res = await pool.query(
      `SELECT a.id, a.name, a.description, a.created_by,
              COUNT(ap.photo_id)::int AS photo_count,
              a.created_at
       FROM albums a
       LEFT JOIN album_photos ap ON ap.album_id = a.id
       WHERE a.created_by = $1
          OR EXISTS (SELECT 1 FROM album_members am WHERE am.album_id = a.id AND am.username = $1)
       GROUP BY a.id
       ORDER BY a.created_at DESC`,
      [username]
    );
    return { count: res.rows.length, albums: res.rows };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── create_album ─────────────────────────────────────────────────────────────
export async function create_album(params, { username, pool }) {
  try {
    const albumRes = await pool.query(
      `INSERT INTO albums (name, description, created_by)
       VALUES ($1, $2, $3) RETURNING id, name`,
      [params.name, params.description || "", username]
    );
    const album = albumRes.rows[0];

    // Owner membership
    await pool.query(
      `INSERT INTO album_members (album_id, username, role)
       VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
      [album.id, username]
    );

    // Add photos
    let photos_added = 0;
    if (params.photo_ids?.length) {
      for (const photoId of params.photo_ids) {
        const r = await pool.query(
          `INSERT INTO album_photos (album_id, photo_id, added_by)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [album.id, photoId, username]
        );
        photos_added += r.rowCount ?? 0;
      }
    }

    // Share
    const shared_with = [];
    if (params.share_with?.length) {
      for (const target of params.share_with) {
        const userCheck = await pool.query(
          "SELECT id FROM users WHERE username = $1", [target]
        );
        if (!userCheck.rows.length) continue;

        await pool.query(
          `INSERT INTO shared_albums (album_id, shared_by, shared_with)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [album.id, username, target]
        );
        await pool.query(
          `INSERT INTO album_members (album_id, username, role)
           VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
          [album.id, target]
        );
        shared_with.push(target);
      }
    }

    return { album_id: album.id, album_name: album.name, photos_added, shared_with };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── share_album ──────────────────────────────────────────────────────────────
export async function share_album(params, { username, pool }) {
  try {
    const ownerCheck = await pool.query(
      "SELECT id FROM albums WHERE id = $1 AND created_by = $2",
      [params.album_id, username]
    );
    if (!ownerCheck.rows.length) return { error: "You don't own this album" };

    const results = [];
    for (const target of params.share_with) {
      const userCheck = await pool.query(
        "SELECT id FROM users WHERE username = $1", [target]
      );
      if (!userCheck.rows.length) {
        results.push({ username: target, error: "User not found" });
        continue;
      }
      await pool.query(
        `INSERT INTO shared_albums (album_id, shared_by, shared_with)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [params.album_id, username, target]
      );
      await pool.query(
        `INSERT INTO album_members (album_id, username, role)
         VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
        [params.album_id, target]
      );
      results.push({ username: target, ok: true });
    }
    return { results };
  } catch (err) {
    return { error: err.message };
  }
  
}

// ── PHASE 2 EXECUTORS — append to executor.js ─────────────────────────────────

// ─── find_duplicates ──────────────────────────────────────────────────────────
export async function find_duplicates(params, { username, pool }) {
  try {
    if (!params.photo_ids?.length) return { error: "photo_ids required" };

    const threshold = typeof params.threshold === "number"
      ? Math.max(0.5, Math.min(1.0, params.threshold))
      : 0.95;

    // Fetch embeddings for photos in this user's library
    // The AND uploaded_by check is intentionally loose here — albums contain
    // photos from multiple users. We fetch all album photos but only flag
    // duplicates so the user can decide which to delete.
    const res = await pool.query(
      `SELECT id, url, filename, uploaded_by,
              embedding::text,
              COALESCE(date_taken, uploaded_at) AS taken_at
       FROM photos
       WHERE id = ANY($1)
         AND embedding IS NOT NULL`,
      [params.photo_ids]
    );

    if (res.rows.length < 2) {
      return { duplicate_pairs: 0, duplicates: [], message: "Not enough photos with embeddings to compare." };
    }

    // Parse pgvector text format "[0.1,0.2,...]" → number[]
    const photos = res.rows.map(r => ({
      id: r.id,
      url: r.url,
      filename: r.filename,
      uploaded_by: r.uploaded_by,
      owned: r.uploaded_by === username,
      taken_at: r.taken_at,
      vec: JSON.parse(r.embedding),
    }));

    // O(n²) cosine similarity — fast enough up to ~500 photos
    // For larger sets, use the pgvector <=> operator in SQL instead
    function cosine(a, b) {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na  += a[i] * a[i];
        nb  += b[i] * b[i];
      }
      return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }

    const duplicates = [];
    for (let i = 0; i < photos.length; i++) {
      for (let j = i + 1; j < photos.length; j++) {
        const sim = cosine(photos[i].vec, photos[j].vec);
        if (sim >= threshold) {
          // Recommend keeping the one taken earlier (original), deleting the copy
          const keepIdx  = photos[i].taken_at <= photos[j].taken_at ? i : j;
          const deleteIdx = keepIdx === i ? j : i;
          duplicates.push({
            similarity: Math.round(sim * 1000) / 1000,
            keep:   { id: photos[keepIdx].id,   url: photos[keepIdx].url,   filename: photos[keepIdx].filename,   owned: photos[keepIdx].owned },
            delete: { id: photos[deleteIdx].id, url: photos[deleteIdx].url, filename: photos[deleteIdx].filename, owned: photos[deleteIdx].owned },
          });
        }
      }
    }

    // Sort highest similarity first
    duplicates.sort((a, b) => b.similarity - a.similarity);

    // Deduplicate — a photo should only appear as delete candidate once
    const markedForDelete = new Set();
    const deduped = [];
    for (const pair of duplicates) {
      if (!markedForDelete.has(pair.delete.id)) {
        markedForDelete.add(pair.delete.id);
        deduped.push(pair);
      }
    }

    const ownedDeleteIds = deduped
      .filter(p => p.delete.owned)
      .map(p => p.delete.id);

    return {
      duplicate_pairs: deduped.length,
      duplicates: deduped,
      // Convenience field: IDs safe to auto-delete (user owns them)
      owned_delete_ids: ownedDeleteIds,
      not_owned_count: deduped.length - ownedDeleteIds.length,
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── delete_photos ────────────────────────────────────────────────────────────
export async function delete_photos(params, { username, pool, supabaseAdmin }) {
  try {
    if (!params.photo_ids?.length) return { error: "photo_ids required" };

    // Hard ownership check — never delete photos you don't own
    const owned = await pool.query(
      `SELECT id, storage_path FROM photos
       WHERE id = ANY($1) AND uploaded_by = $2`,
      [params.photo_ids, username]
    );

    const ownedRows = owned.rows;
    const skipped   = params.photo_ids.length - ownedRows.length;

    if (ownedRows.length === 0) {
      return { error: "None of these photos belong to you. Only a photo's uploader can delete it.", deleted: 0, skipped: params.photo_ids.length };
    }

    const ownedIds    = ownedRows.map(r => r.id);
    const storagePaths = ownedRows.map(r => r.storage_path).filter(Boolean);

    // Delete from Supabase Storage first (fire-and-note-errors, don't block)
    if (storagePaths.length > 0) {
      const { error: storageErr } = await supabaseAdmin.storage
        .from("photos")
        .remove(storagePaths);
      if (storageErr) console.error("[agent/delete_photos] storage error:", storageErr);
    }

    // Delete from DB — cascade handles album_photos, photo_people, shared_photos
    await pool.query(
      `DELETE FROM photos WHERE id = ANY($1) AND uploaded_by = $2`,
      [ownedIds, username]
    );

    return {
      deleted: ownedIds.length,
      skipped,
      skipped_reason: skipped > 0 ? "Some photos were uploaded by other users and were not deleted." : null,
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── get_people_stats ─────────────────────────────────────────────────────────
export async function get_people_stats(params, { username, pool }) {
  try {
    const topN    = params.top_n    || 10;
    const daysAgo = params.days_ago || null;

    // Count from both photo_people and face_tags — your schema uses both
    const dateFilter = daysAgo
      ? `AND COALESCE(p.date_taken, p.uploaded_at) >= NOW() - INTERVAL '${parseInt(daysAgo)} days'`
      : "";

    const res = await pool.query(
      `SELECT
         per.name,
         per.cover_photo_url,
         COUNT(DISTINCT pp.photo_id)::int AS photo_count,
         MAX(COALESCE(p.date_taken, p.uploaded_at)) AS last_seen,
         MIN(COALESCE(p.date_taken, p.uploaded_at)) AS first_seen
       FROM people per
       JOIN (
         SELECT person_id, photo_id FROM photo_people
         UNION
         SELECT person_id, photo_id FROM face_tags
       ) pp ON pp.person_id = per.id
       JOIN photos p ON p.id = pp.photo_id
       WHERE per.username = $1
         ${dateFilter}
       GROUP BY per.id, per.name, per.cover_photo_url
       ORDER BY photo_count DESC
       LIMIT $2`,
      [username, topN]
    );

    if (res.rows.length === 0) {
      return {
        people: [],
        message: "No tagged people found. Tag faces on the People page first so I can analyse them.",
      };
    }

    return {
      total_tagged_people: res.rows.length,
      period: daysAgo ? `Last ${daysAgo} days` : "All time",
      people: res.rows.map(r => ({
        name:            r.name,
        photo_count:     r.photo_count,
        cover_photo_url: r.cover_photo_url,
        first_seen:      r.first_seen,
        last_seen:       r.last_seen,
      })),
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── build_highlight_reel ─────────────────────────────────────────────────────
export async function build_highlight_reel(params, { username, pool }) {
  try {
    if (!params.photo_ids?.length) return { error: "photo_ids required" };

    const count       = Math.min(params.count || 20, 50);
    const focusPerson = params.focus_person || null;

    // Emotion scoring — mirrors your existing search route logic
    const EMOTION_SCORE = {
      happy: 5, excited: 5, surprised: 3, calm: 2,
      neutral: 1, sad: -2, fearful: -3, angry: -4, disgusted: -4,
    };

    let sql, queryParams;

    if (focusPerson) {
      // Filter to photos containing this person, then score
      sql = `
        SELECT DISTINCT p.id, p.url, p.filename, p.dominant_emotion,
               p.face_count, p.width, p.height, p.date_taken, p.place_name,
               p.ai_description, p.uploaded_by
        FROM photos p
        WHERE p.id = ANY($1)
          AND EXISTS (
            SELECT 1 FROM (
              SELECT person_id, photo_id FROM photo_people
              UNION
              SELECT person_id, photo_id FROM face_tags
            ) pp
            JOIN people per ON per.id = pp.person_id
            WHERE pp.photo_id = p.id
              AND per.name ILIKE $2
              AND per.username = $3
          )
      `;
      queryParams = [params.photo_ids, `%${focusPerson}%`, username];
    } else {
      sql = `
        SELECT p.id, p.url, p.filename, p.dominant_emotion,
               p.face_count, p.width, p.height, p.date_taken, p.place_name,
               p.ai_description, p.uploaded_by
        FROM photos p
        WHERE p.id = ANY($1)
      `;
      queryParams = [params.photo_ids];
    }

    const res = await pool.query(sql, queryParams);

    if (res.rows.length === 0) {
      return {
        error: focusPerson
          ? `No photos found containing "${focusPerson}". Make sure this person is tagged on the People page.`
          : "No photos found in the given pool.",
      };
    }

    // Score every photo
    const scored = res.rows.map(p => {
      const emotionScore = EMOTION_SCORE[p.dominant_emotion] ?? 0;
      const resScore     = ((p.width || 0) * (p.height || 0)) / 2_000_000;
      const faceBonus    = p.face_count > 0 ? 3 : 0;
      return {
        ...p,
        _score: emotionScore * 4 + resScore + faceBonus,
      };
    });

    // Sort descending, take top `count`
    scored.sort((a, b) => b._score - a._score);
    const highlights = scored.slice(0, count).map(({ _score, ...p }) => p);

    return {
      total_pool:     res.rows.length,
      selected_count: highlights.length,
      focus_person:   focusPerson,
      highlights,
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── prepare_download ─────────────────────────────────────────────────────────
// Server-side: verify access and return photo URLs.
// Client-side: agent page watches for __type: "DOWNLOAD_READY" and triggers jszip.
export async function prepare_download(params, { username, pool }) {
  try {
    if (!params.photo_ids?.length) return { error: "photo_ids required" };

    // Return photos the user either owns or has album access to
    const res = await pool.query(
      `SELECT DISTINCT p.id, p.url, p.filename
       FROM photos p
       WHERE p.id = ANY($1)
         AND (
           p.uploaded_by = $2
           OR EXISTS (
             SELECT 1 FROM album_photos ap
             JOIN album_members am ON am.album_id = ap.album_id
             WHERE ap.photo_id = p.id AND am.username = $2
           )
         )
       ORDER BY p.id`,
      [params.photo_ids, username]
    );

    if (res.rows.length === 0) {
      return { error: "No accessible photos found for download." };
    }

    return {
      __type:    "DOWNLOAD_READY",   // Signal caught by the agent UI
      zip_name:  params.zip_name || "gathrd-export",
      count:     res.rows.length,
      photos:    res.rows,
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── ask_user_confirmation ────────────────────────────────────────────────────
// This is a signal, not a real execution. The loop catches it and pauses.
export async function ask_user_confirmation(params) {
  return {
    __type: "CONFIRMATION_REQUIRED",
    message: params.message,
    action_preview: params.action_preview || "",
    severity: params.severity,
  };
}

// ─── get_top_photos ───────────────────────────────────────────────────────────
export async function get_top_photos(params, { username, pool }) {
  try {
    const minScore = params.min_score ?? 70;
    const limit    = Math.min(params.limit ?? 20, 50);

    let sql = `
      SELECT id, url, filename, content_score, dominant_emotion,
             face_count, place_name, date_taken, ai_description
      FROM photos
      WHERE uploaded_by = $1 AND content_score >= $2
    `;
    const values = [username, minScore];

    if (params.days_ago) {
      sql += ` AND COALESCE(date_taken, uploaded_at) >= NOW() - INTERVAL '${parseInt(params.days_ago)} days'`;
    }

    sql += ` ORDER BY content_score DESC LIMIT $3`;
    values.push(limit);

    const res = await pool.query(sql, values);

    return {
      count: res.rows.length,
      photos: res.rows,
      note: res.rows.length === 0
        ? `No photos found with score above ${minScore}. Try a lower min_score.`
        : null,
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── generate_captions ────────────────────────────────────────────────────────
export async function generate_captions(params, { username, pool }) {
  try {
    if (!params.photo_ids?.length) return { error: "photo_ids required" };
    const platform = params.platform || "instagram";

    const PLATFORM_PROMPTS = {
      instagram: "Engaging Instagram caption, 2-3 sentences, relevant emojis, 5-8 hashtags at end.",
      linkedin:  "Professional LinkedIn post, 2-3 sentences, no hashtags, focus on story or insight.",
      twitter:   "Twitter post under 280 characters, punchy, 1-2 hashtags max.",
      threads:   "Threads post, casual and authentic, 1-2 sentences, minimal hashtags.",
    };

    const photosRes = await pool.query(
      `SELECT p.id, p.ai_description, p.dominant_emotion,
              p.place_name, p.date_taken,
              ARRAY_AGG(per.name) FILTER (WHERE per.name IS NOT NULL) AS people
       FROM photos p
       LEFT JOIN photo_people pp ON pp.photo_id = p.id
       LEFT JOIN people per ON per.id = pp.person_id AND per.username = $1
       WHERE p.id = ANY($2) AND p.uploaded_by = $1
       GROUP BY p.id`,
      [username, params.photo_ids]
    );

    const captions = [];
    for (const photo of photosRes.rows) {
      const context = [
        photo.ai_description,
        photo.dominant_emotion && `Mood: ${photo.dominant_emotion}`,
        photo.place_name && `Location: ${photo.place_name}`,
        photo.people?.filter(Boolean).length > 0 && `With: ${photo.people.filter(Boolean).join(', ')}`,
      ].filter(Boolean).join('. ');

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 150,
          messages: [
            { role: "system", content: `Write a social media caption. ${PLATFORM_PROMPTS[platform]} Return only the caption text.` },
            { role: "user",   content: context || "A photo." },
          ],
        }),
      });
      const data = await res.json();
      captions.push({
        photo_id: photo.id,
        caption: data.choices?.[0]?.message?.content?.trim() || "Caption unavailable.",
      });
    }

    return { platform, count: captions.length, captions };
  } catch (err) {
    return { error: err.message };
  }
}

export const EXECUTORS = {
  search_photos, get_album, list_albums, create_album, share_album, ask_user_confirmation,
  find_duplicates, delete_photos, get_people_stats, build_highlight_reel, prepare_download,
  get_top_photos, generate_captions,
};