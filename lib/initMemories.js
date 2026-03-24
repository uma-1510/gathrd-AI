import pool from "./db";

let initialized = false;

export async function initMemories() {
  if (initialized) return;
  initialized = true;

  // Add pinned column to albums (safe — ignored if already exists)
  await pool.query(`
    ALTER TABLE albums ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT false;
  `).catch(() => {});

  // Memories table — one row per generated monthly (or custom) memory
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memories (
      id            SERIAL PRIMARY KEY,
      username      VARCHAR(50) NOT NULL,
      title         TEXT NOT NULL,
      subtitle      TEXT,
      date_label    TEXT NOT NULL,
      period_start  DATE NOT NULL,
      period_end    DATE NOT NULL,
      cover_url     TEXT,
      photo_ids     INTEGER[] NOT NULL DEFAULT '{}',
      photo_count   INTEGER NOT NULL DEFAULT 0,
      dominant_mood VARCHAR(50),
      generated_at  TIMESTAMP DEFAULT NOW()
    );
  `);

  // Index for fast per-user lookups
  await pool.query(`
    CREATE INDEX IF NOT EXISTS memories_username_idx
    ON memories (username, period_start DESC);
  `).catch(() => {});

  console.log("Memories schema ready");
}