import pool from "./db";

/**
 * Runs DB migration exactly ONCE per server process lifetime.
 * After the first successful run, all subsequent calls are instant no-ops.
 *
 * This means zero extra DB queries on every request after startup —
 * no wasted connections, no latency, no Gemini calls triggered by migration.
 *
 * One-time manual step in Supabase SQL Editor before first use:
 *   CREATE EXTENSION IF NOT EXISTS vector;
 */
let migrationDone = false;

export async function migrateAI() {
  // Already ran this server process — skip entirely
  if (migrationDone) return;

  // Enable pgvector extension
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

  // Add AI columns — 768 dims (gemini-embedding-001 truncated via outputDimensionality)
  await pool.query(`
    ALTER TABLE photos
      ADD COLUMN IF NOT EXISTS ai_description   TEXT,
      ADD COLUMN IF NOT EXISTS embedding        vector(768),
      ADD COLUMN IF NOT EXISTS face_count       INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS dominant_emotion VARCHAR(50);
  `);

  // HNSW index — works fine at 768 dims
  await pool.query(`
    CREATE INDEX IF NOT EXISTS photos_embedding_hnsw
      ON photos
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  `);

  migrationDone = true;
  console.log("migrateAI: done — will not run again this process");
}