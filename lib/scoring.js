// lib/scoring.js
// Pure function — no DB, no API calls.
// Takes a photo row and returns a content score 0–100.
// Used by: upload route, re-analyze route, API endpoint, agent tools.

const EMOTION_SCORE = {
  happy: 10, excited: 10, surprised: 6,
  calm: 4,  neutral: 2,
  sad: -4,  fearful: -5, angry: -6, disgusted: -6,
};

export function scorePhoto(photo) {
  let score = 0;

  // 1. Emotion — primary signal (0–10 pts)
  score += EMOTION_SCORE[photo.dominant_emotion] ?? 0;

  // 2. Faces present — social photos perform better (0–6 pts)
  if (photo.face_count >= 3) score += 6;
  else if (photo.face_count === 2) score += 5;
  else if (photo.face_count === 1) score += 3;

  // 3. Resolution — sharpness proxy (0–8 pts)
  const megapixels = ((photo.width || 0) * (photo.height || 0)) / 1_000_000;
  if (megapixels >= 8)      score += 8;
  else if (megapixels >= 4) score += 6;
  else if (megapixels >= 2) score += 4;
  else if (megapixels >= 1) score += 2;

  // 4. Has location — context-rich photos score better (0–3 pts)
  if (photo.place_name) score += 3;

  // 5. Has AI description — fully indexed (0–3 pts)
  if (photo.ai_description && photo.ai_description.length > 40) score += 3;

  // 6. Has named people — relational content (0–4 pts)
  // photo.people is an array attached after DB join — may not always be present
  if (Array.isArray(photo.people) && photo.people.length > 0) score += 4;

  // Clamp to 0–100, normalise from raw max of ~34
  const raw = Math.max(0, score);
  return Math.min(100, Math.round((raw / 34) * 100));
}

// Tier label for UI display
export function scoreTier(score) {
  if (score >= 80) return { label: "Top pick",   color: "#16a34a", bg: "rgba(22,163,74,0.08)"  };
  if (score >= 60) return { label: "Great",       color: "#2563eb", bg: "rgba(37,99,235,0.08)"  };
  if (score >= 40) return { label: "Good",        color: "#d97706", bg: "rgba(217,119,6,0.08)"  };
  return               { label: "Low",           color: "#9ca3af", bg: "rgba(156,163,175,0.08)" };
}