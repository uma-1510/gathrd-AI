// lib/initDb.js
import pool from "./db";

let initialized = false;

// ── Capstone limits ───────────────────────────────────────────────────────────
export const SHARED_ALBUM_MAX_MEMBERS = 20;
export const SHARED_ALBUM_MAX_PHOTOS  = 500;
export const ALBUM_MAX_COMMENTS       = 200;
export const ALBUM_COMMENT_MAX_LEN    = 500;

export async function initDb() {
  if (initialized) return;
  initialized = true;

  // Core tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255),
      role VARCHAR(20) DEFAULT 'user',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS photos (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      uploaded_by VARCHAR(50) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      url TEXT NOT NULL,
      storage_path TEXT,
      mime_type VARCHAR(100),
      file_size INTEGER,
      width INTEGER,
      height INTEGER,
      format VARCHAR(50),
      date_taken TIMESTAMP,
      camera_make VARCHAR(100),
      camera_model VARCHAR(100),
      latitude NUMERIC(10,7),
      longitude NUMERIC(10,7),
      face_count INTEGER DEFAULT 0,
      dominant_emotion VARCHAR(50),
      ai_description TEXT,
      embedding vector(384),
      uploaded_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS people (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) NOT NULL,
      name VARCHAR(100) NOT NULL,
      face_descriptor FLOAT[] NOT NULL,
      cover_photo_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(username, name)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS photo_people (
      id SERIAL PRIMARY KEY,
      photo_id INTEGER REFERENCES photos(id) ON DELETE CASCADE,
      person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
      confidence NUMERIC(4,3) DEFAULT 1.0,
      UNIQUE(photo_id, person_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS albums (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      created_by VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS album_photos (
      id SERIAL PRIMARY KEY,
      album_id INTEGER REFERENCES albums(id) ON DELETE CASCADE,
      photo_id INTEGER REFERENCES photos(id) ON DELETE CASCADE,
      added_by VARCHAR(50),
      added_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(album_id, photo_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shared_photos (
      id SERIAL PRIMARY KEY,
      photo_id INTEGER REFERENCES photos(id) ON DELETE CASCADE,
      shared_by VARCHAR(50) NOT NULL,
      shared_with VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(photo_id, shared_with)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shared_albums (
      id SERIAL PRIMARY KEY,
      album_id INTEGER REFERENCES albums(id) ON DELETE CASCADE,
      shared_by VARCHAR(50) NOT NULL,
      shared_with VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(album_id, shared_with)
    );
  `);

  // ── NEW: album_members — tracks everyone with access to a shared album ─────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS album_members (
      id        SERIAL PRIMARY KEY,
      album_id  INTEGER REFERENCES albums(id) ON DELETE CASCADE,
      username  VARCHAR(50) NOT NULL,
      role      VARCHAR(20) DEFAULT 'member',  -- 'owner' | 'member'
      joined_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(album_id, username)
    );
  `);

  // ── NEW: album_comments — chat thread per shared album ────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS album_comments (
      id         SERIAL PRIMARY KEY,
      album_id   INTEGER REFERENCES albums(id) ON DELETE CASCADE,
      username   VARCHAR(50) NOT NULL,
      message    TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      created_by VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_members (
      id SERIAL PRIMARY KEY,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      username VARCHAR(50) NOT NULL,
      role VARCHAR(20) DEFAULT 'member',
      joined_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(group_id, username)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_albums (
      id SERIAL PRIMARY KEY,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      album_id INTEGER REFERENCES albums(id) ON DELETE CASCADE,
      shared_by VARCHAR(50) NOT NULL,
      shared_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(group_id, album_id)
    );
  `);

  // Migrate existing photos table
  const alterCols = [
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100)",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS file_size INTEGER",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS width INTEGER",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS height INTEGER",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS format VARCHAR(50)",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS date_taken TIMESTAMP",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS camera_make VARCHAR(100)",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS camera_model VARCHAR(100)",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7)",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7)",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS face_count INTEGER DEFAULT 0",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS dominant_emotion VARCHAR(50)",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS ai_description TEXT",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS place_name VARCHAR(255)",
    // album_photos: track who added each photo
    "ALTER TABLE album_photos ADD COLUMN IF NOT EXISTS added_by VARCHAR(50)",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS content_score INTEGER DEFAULT 0",
    "ALTER TABLE albums ADD COLUMN IF NOT EXISTS story_summary TEXT",
  ];
  for (const sql of alterCols) {
    await pool.query(sql).catch(() => {});
  }

  await pool.query(
    `ALTER TABLE photos ADD COLUMN IF NOT EXISTS embedding vector(384)`
  ).catch(() => {});

  await pool.query(`
    CREATE INDEX IF NOT EXISTS photos_embedding_hnsw
    ON photos USING hnsw (embedding vector_cosine_ops)
  `).catch(() => {});

  console.log("DB initialized");
}