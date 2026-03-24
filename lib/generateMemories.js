import pool from "./db";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// Moods ranked by how "memorable" they are for highlights
const MOOD_RANK = {
  happy: 5, excited: 5, surprised: 4, calm: 3,
  neutral: 2, sad: 1, fearful: 0, angry: 0, disgusted: 0,
};

function moodScore(emotion) {
  return MOOD_RANK[emotion] ?? 2;
}

function buildTitle(year, month /* 1-based */, mood) {
  const monthName = MONTH_NAMES[month - 1];
  const moodPhrases = {
    happy:    ["Joyful", "Happy", "Bright"],
    excited:  ["Exciting", "Electric", "Vibrant"],
    surprised:["Unexpected", "Surprising", "Wonderful"],
    calm:     ["Calm", "Peaceful", "Quiet"],
    neutral:  ["Everyday", "Ordinary", "Familiar"],
  };
  const options = moodPhrases[mood] ?? ["Memorable"];
  const adjective = options[Math.floor(Math.random() * options.length)];
  return `${adjective} ${monthName}`;
}

function buildSubtitle(photoCount, year) {
  if (photoCount === 1) return `1 memory from ${year}`;
  return `${photoCount} memories from ${year}`;
}

/**
 * generateMemoriesForUser(username)
 *
 * Looks at all photos for the user grouped by calendar month.
 * For any month that doesn't yet have a memories row, inserts one.
 * Returns an array of newly created memory ids.
 */
export async function generateMemoriesForUser(username) {
  // Get all photos with date info — prefer date_taken, fall back to uploaded_at
  const photosRes = await pool.query(`
    SELECT
      id,
      url,
      COALESCE(date_taken, uploaded_at) AS effective_date,
      dominant_emotion,
      face_count
    FROM photos
    WHERE uploaded_by = $1
      AND (date_taken IS NOT NULL OR uploaded_at IS NOT NULL)
    ORDER BY effective_date ASC
  `, [username]);

  const photos = photosRes.rows;
  if (!photos.length) return [];

  // Group by year-month
  const byMonth = new Map();
  for (const photo of photos) {
    const d = new Date(photo.effective_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(photo);
  }

  // Find which months already have a memory row
  const existingRes = await pool.query(`
    SELECT TO_CHAR(period_start, 'YYYY-MM') AS month_key
    FROM memories
    WHERE username = $1
  `, [username]);
  const existingMonths = new Set(existingRes.rows.map(r => r.month_key));

  const created = [];

  for (const [monthKey, monthPhotos] of byMonth.entries()) {
    if (existingMonths.has(monthKey)) continue; // already generated

    const [year, month] = monthKey.split("-").map(Number);

    // Sort by mood score descending, then face_count descending — best photos first
    const sorted = [...monthPhotos].sort((a, b) => {
      const moodDiff = moodScore(b.dominant_emotion) - moodScore(a.dominant_emotion);
      if (moodDiff !== 0) return moodDiff;
      return (b.face_count ?? 0) - (a.face_count ?? 0);
    });

    // Pick best photo as cover
    const coverPhoto = sorted[0];
    const coverUrl = coverPhoto.url;

    // Dominant mood of the month (most common happy/positive emotion)
    const moodCounts = {};
    for (const p of monthPhotos) {
      if (p.dominant_emotion) {
        moodCounts[p.dominant_emotion] = (moodCounts[p.dominant_emotion] ?? 0) + 1;
      }
    }
    const dominantMood = Object.entries(moodCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([mood]) => mood)[0] ?? "neutral";

    const title = buildTitle(year, month, dominantMood);
    const subtitle = buildSubtitle(monthPhotos.length, year);
    const dateLabel = `${MONTH_NAMES[month - 1]} ${year}`;
    const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
    // Last day of month
    const periodEnd = new Date(year, month, 0).toISOString().split("T")[0];
    const photoIds = monthPhotos.map(p => p.id);

    const ins = await pool.query(`
      INSERT INTO memories
        (username, title, subtitle, date_label, period_start, period_end,
         cover_url, photo_ids, photo_count, dominant_mood)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [
      username, title, subtitle, dateLabel,
      periodStart, periodEnd,
      coverUrl,
      photoIds,
      monthPhotos.length,
      dominantMood,
    ]);

    if (ins.rows[0]) created.push(ins.rows[0].id);
  }

  return created;
}