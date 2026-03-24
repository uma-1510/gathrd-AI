function localMidnight(date, tzOffsetMinutes) {
  // date is already a JS Date. We want 00:00:00 in the user's local timezone.
  // Strategy: figure out what UTC time corresponds to local midnight.
  const d = new Date(date);
  // Reset to midnight in LOCAL time by working in UTC + offset
  d.setUTCHours(0, 0, 0, 0);
  // Shift: if user is UTC-4, their local midnight is 04:00 UTC
  d.setTime(d.getTime() + tzOffsetMinutes * 60 * 1000);
  return d;
}

function localEndOfDay(date, tzOffsetMinutes) {
  const start = localMidnight(date, tzOffsetMinutes);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

// ── Date range builder 
function getDateRange(query, tzOffsetMinutes = 0) {
  const q = query.toLowerCase();
  const now = new Date();

  // Explicit year: "2025", "2024"
  const yearMatch = q.match(/\b(202\d)\b/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1]);
    return {
      after:  new Date(`${y}-01-01T00:00:00Z`),
      before: new Date(`${y}-12-31T23:59:59Z`),
      label:  yearMatch[1],
    };
  }

  // "today" — midnight..end-of-day in user's local timezone
  if (q.includes("today")) {
    return {
      after:  localMidnight(now, tzOffsetMinutes),
      before: localEndOfDay(now, tzOffsetMinutes),
      label:  "today",
    };
  }

  // "yesterday"
  if (q.includes("yesterday")) {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return {
      after:  localMidnight(yesterday, tzOffsetMinutes),
      before: localEndOfDay(yesterday, tzOffsetMinutes),
      label:  "yesterday",
    };
  }

  // "last week"
  if (q.includes("last week")) {
    const start = new Date(now); start.setDate(now.getDate() - 14);
    const end   = new Date(now); end.setDate(now.getDate() - 7);
    return { after: start, before: end, label: "last week" };
  }

  // "this week"
  if (q.includes("this week")) {
    const start = new Date(now); start.setDate(now.getDate() - 7);
    return { after: start, before: now, label: "this week" };
  }

  // "last month"
  if (q.includes("last month")) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return { after: start, before: end, label: "last month" };
  }

  // "this month"
  if (q.includes("this month")) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { after: start, before: now, label: "this month" };
  }

  // Seasons: "last summer", "winter 2024"
  const seasons = {
    spring: { start: [3, 1],  end: [5, 31]  },
    summer: { start: [6, 1],  end: [8, 31]  },
    fall:   { start: [9, 1],  end: [11, 30] },
    autumn: { start: [9, 1],  end: [11, 30] },
    winter: { start: [12, 1], end: [2, 28]  },
  };
  for (const [season, months] of Object.entries(seasons)) {
    if (q.includes(season)) {
      const y = yearMatch
        ? parseInt(yearMatch[1])
        : now.getFullYear() - (q.includes("last") ? 1 : 0);
      const start = new Date(y, months.start[0] - 1, months.start[1]);
      const end   = new Date(
        season === "winter" ? y + 1 : y,
        months.end[0] - 1,
        months.end[1],
        23, 59, 59,
      );
      return { after: start, before: end, label: `${season} ${y}` };
    }
  }

  // Month name: "june", "last july"
  const monthNames = [
    "january","february","march","april","may","june",
    "july","august","september","october","november","december",
  ];
  for (let i = 0; i < monthNames.length; i++) {
    if (q.includes(monthNames[i])) {
      const y = yearMatch
        ? parseInt(yearMatch[1])
        : now.getFullYear() - (q.includes("last") ? 1 : 0);
      const start = new Date(y, i, 1);
      const end   = new Date(y, i + 1, 0, 23, 59, 59);
      return { after: start, before: end, label: `${monthNames[i]} ${y}` };
    }
  }

  // "last N days/weeks/months"
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

// ── Event / occasion keywords 
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

// ── Quality / selection keywords 
const QUALITY_KEYWORDS = [
  "best", "good", "clear", "nice", "beautiful", "pretty",
  "instagram", "post", "share", "profile",
  "blurry", "dark", "bright",
];

// ── Main parser 
// tzOffsetMinutes: value of `new Date().getTimezoneOffset()` from the browser.
// Positive for zones west of UTC (e.g. EDT = 240), negative for east (IST = -330).
export function parseQuery(rawQuery, tzOffsetMinutes = 0) {
  const q = rawQuery.toLowerCase().trim();

  const dateRange = getDateRange(q, tzOffsetMinutes);

  const withMatch = q.match(/\bwith\s+([a-z][a-z\s]+?)(?:\s+(?:in|on|from|last|this|at|and)|$)/);
  const personHint = withMatch ? withMatch[1].trim() : null;

  const events = EVENT_KEYWORDS.filter(kw => q.includes(kw));
  const wantsQuality = QUALITY_KEYWORDS.some(kw => q.includes(kw));

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

  if (!semanticText) semanticText = rawQuery;

  return {
    raw:           rawQuery,
    semantic:      semanticText,
    dateRange,
    personHint,
    events,
    wantsQuality,
    hasDateFilter:   !!dateRange,
    hasPersonFilter: !!personHint,
    hasEventFilter:  events.length > 0,
  };
}