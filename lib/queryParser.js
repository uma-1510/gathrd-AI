// ── Natural language query parser ─────────────────────────────────────────────
// Understands user intent from free text queries like:
//   "show me photos from my birthday 2025"
//   "photos with Gautam last summer"
//   "beach trip in july"
//   "selfies from last week"
//   "today's photos"
//
// Returns a structured intent object the search route uses.

// ── Date helpers ──────────────────────────────────────────────────────────────
function getDateRange(query) {
  const q = query.toLowerCase();
  const now = new Date();
  const year = now.getFullYear();

  // Explicit year: "2025", "2024"
  const yearMatch = q.match(/\b(202\d)\b/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1]);
    return {
      after:  new Date(`${y}-01-01`),
      before: new Date(`${y}-12-31T23:59:59`),
      label:  yearMatch[1],
    };
  }

  // "today"
  if (q.includes("today")) {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end   = new Date(now); end.setHours(23, 59, 59, 999);
    return { after: start, before: end, label: "today" };
  }

  // "yesterday"
  if (q.includes("yesterday")) {
    const d = new Date(now); d.setDate(d.getDate() - 1);
    const start = new Date(d); start.setHours(0, 0, 0, 0);
    const end   = new Date(d); end.setHours(23, 59, 59, 999);
    return { after: start, before: end, label: "yesterday" };
  }

  // "last week" / "this week"
  if (q.includes("last week")) {
    const start = new Date(now); start.setDate(now.getDate() - 14);
    const end   = new Date(now); end.setDate(now.getDate() - 7);
    return { after: start, before: end, label: "last week" };
  }
  if (q.includes("this week")) {
    const start = new Date(now); start.setDate(now.getDate() - 7);
    return { after: start, before: now, label: "this week" };
  }

  // "last month" / "this month"
  if (q.includes("last month")) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return { after: start, before: end, label: "last month" };
  }
  if (q.includes("this month")) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { after: start, before: now, label: "this month" };
  }

  // Season: "last summer", "winter 2024"
  const seasons = {
    spring: { start: [3, 1], end: [5, 31] },
    summer: { start: [6, 1], end: [8, 31] },
    fall:   { start: [9, 1], end: [11, 30] },
    autumn: { start: [9, 1], end: [11, 30] },
    winter: { start: [12, 1], end: [2, 28] },
  };
  for (const [season, months] of Object.entries(seasons)) {
    if (q.includes(season)) {
      const y = yearMatch ? parseInt(yearMatch[1]) : year - (q.includes("last") ? 1 : 0);
      const start = new Date(y, months.start[0] - 1, months.start[1]);
      const end   = new Date(season === "winter" ? y + 1 : y, months.end[0] - 1, months.end[1], 23, 59, 59);
      return { after: start, before: end, label: `${season} ${y}` };
    }
  }

  // Month name: "june", "last july"
  const months = ["january","february","march","april","may","june",
                  "july","august","september","october","november","december"];
  for (let i = 0; i < months.length; i++) {
    if (q.includes(months[i])) {
      const y = yearMatch ? parseInt(yearMatch[1]) : year - (q.includes("last") ? 1 : 0);
      const start = new Date(y, i, 1);
      const end   = new Date(y, i + 1, 0, 23, 59, 59);
      return { after: start, before: end, label: `${months[i]} ${y}` };
    }
  }

  // "last N days/weeks"
  const relMatch = q.match(/last\s+(\d+)\s+(day|week|month)/);
  if (relMatch) {
    const n    = parseInt(relMatch[1]);
    const unit = relMatch[2];
    const start = new Date(now);
    if (unit === "day")   start.setDate(now.getDate() - n);
    if (unit === "week")  start.setDate(now.getDate() - n * 7);
    if (unit === "month") start.setMonth(now.getMonth() - n);
    return { after: start, before: now, label: `last ${n} ${unit}s` };
  }

  return null;
}

// ── Event / occasion keywords ─────────────────────────────────────────────────
const EVENT_KEYWORDS = [
  "birthday", "party", "wedding", "graduation", "anniversary",
  "vacation", "holiday", "christmas", "diwali", "eid", "holi",
  "new year", "halloween", "thanksgiving", "trip", "travel",
  "beach", "mountain", "hiking", "picnic", "concert", "festival",
  "dinner", "lunch", "breakfast", "restaurant", "cafe",
  "family", "friends", "selfie", "portrait", "sunset", "sunrise",
  "dog", "cat", "pet", "baby", "kid", "child",
  "gym", "workout", "sport", "game", "match",
];

// ── Quality / selection keywords ─────────────────────────────────────────────
const QUALITY_KEYWORDS = [
  "best", "good", "clear", "nice", "beautiful", "pretty",
  "instagram", "post", "share", "profile",
  "blurry", "dark", "bright",
];

// ── Main parser ───────────────────────────────────────────────────────────────
export function parseQuery(rawQuery) {
  const q = rawQuery.toLowerCase().trim();

  // Date intent
  const dateRange = getDateRange(q);

  // People mentioned — collect words after "with", "of", person names
  // (actual name matching happens in the search route via people table)
  const withMatch = q.match(/\bwith\s+([a-z][a-z\s]+?)(?:\s+(?:in|on|from|last|this|at|and)|$)/);
  const personHint = withMatch ? withMatch[1].trim() : null;

  // Event keywords present in query
  const events = EVENT_KEYWORDS.filter(kw => q.includes(kw));

  // Quality intent
  const wantsQuality = QUALITY_KEYWORDS.some(kw => q.includes(kw));

  // Build semantic search text — strip time/person references, keep the "what" part
  // This is what gets embedded for vector search
  let semanticText = rawQuery
    .replace(/\b(show|get|find|give|display|fetch)\s+(me\s+)?(my\s+)?/gi, "")
    .replace(/\b(photos?|images?|pictures?|pics?)\s*(from|of|with|in|on|at)?\s*/gi, "")
    .replace(/\b(today|yesterday|last\s+week|this\s+week|last\s+month|this\s+month)\b/gi, "")
    .replace(/\b202\d\b/g, "")
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, "")
    .replace(/\b(spring|summer|fall|autumn|winter)\b/gi, "")
    .replace(/\bwith\s+[a-z][a-z\s]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // Fallback: if semantic text is empty, use the original
  if (!semanticText) semanticText = rawQuery;

  return {
    raw:          rawQuery,
    semantic:     semanticText,
    dateRange,
    personHint,
    events,
    wantsQuality,
    hasDateFilter:    !!dateRange,
    hasPersonFilter:  !!personHint,
    hasEventFilter:   events.length > 0,
  };
}