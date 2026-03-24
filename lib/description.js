// ── Event enrichment map: BLIP caption keywords → searchable event phrases ────
const EVENT_ENRICHMENT = {
  "birthday": ["birthday celebration", "birthday party"],
  "cake": ["birthday celebration", "cake cutting"],
  "candle": ["birthday celebration", "candles"],
  "wedding": ["wedding ceremony", "marriage celebration"],
  "bride": ["wedding ceremony"], "groom": ["wedding ceremony"],
  "bouquet": ["wedding ceremony", "flower bouquet"],
  "graduation": ["graduation ceremony", "commencement"],
  "diploma": ["graduation ceremony"], "cap and gown": ["graduation ceremony"],
  "beach": ["beach outing", "seaside"], "ocean": ["beach outing", "ocean view"],
  "mountain": ["mountain trip", "hiking adventure"],
  "hiking": ["hiking adventure", "outdoor trek"],
  "sunset": ["sunset scene", "golden hour"], "sunrise": ["sunrise scene", "early morning"],
  "christmas": ["christmas celebration", "holiday season"],
  "gift": ["gift giving", "present"], "dinner": ["dinner gathering", "meal"],
  "restaurant": ["restaurant dining", "eating out"],
  "concert": ["concert event", "live music"], "dance": ["dancing", "party"],
  "pool": ["pool party", "swimming"],
  "baby": ["baby photo", "infant"], "dog": ["pet dog"], "cat": ["pet cat"],
  "selfie": ["selfie", "self portrait"], "group": ["group photo", "gathering"],
};

function isGenericCaption(caption) {
  if (!caption) return true;
  const lower = caption.toLowerCase().trim();
  if (lower.length < 12) return true;
  const genericStarts = [
    "a close up of a", "a picture of a", "a photo of a",
    "an image of a", "there is a", "arafed", "a blurry photo",
    "a black and white photo", "a screenshot of a",
  ];
  return genericStarts.some(p => lower.startsWith(p) && lower.length < 35);
}

function extractEventPhrases(caption) {
  if (!caption) return [];
  const lower = caption.toLowerCase();
  const phrases = new Set();
  for (const [keyword, enrichments] of Object.entries(EVENT_ENRICHMENT)) {
    if (lower.includes(keyword)) enrichments.forEach(e => phrases.add(e));
  }
  return [...phrases];
}

/**
 * Build rich description. Returns { description, needsRecaption }.
 * needsRecaption=true means BLIP failed or was generic — flag photo for re-processing.
 */
export function buildDescription({ caption = null, filename = "", exif = {}, faceCount = 0, emotion = null, peopleNames = [] } = {}) {
  const parts = [];
  let needsRecaption = false;

  if (caption && !isGenericCaption(caption)) {
    parts.push(caption.endsWith(".") ? caption : caption + ".");
    const eventPhrases = extractEventPhrases(caption);
    if (eventPhrases.length > 0) parts.push(`Scene: ${eventPhrases.join(", ")}.`);
  } else {
    needsRecaption = true;
    const cleaned = filename.replace(/\.[^.]+$/, "").replace(/^\d+-/, "").replace(/[-_]+/g, " ")
      .replace(/Gemini Generated Image \w+/gi, "AI generated image").trim();
    if (cleaned) parts.push(`Photo: ${cleaned}.`);
  }

  if (exif?.DateTimeOriginal) {
    parts.push(`Taken on ${new Date(exif.DateTimeOriginal).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`);
  }
  if (exif?.Make) parts.push(`Shot on ${exif.Make}${exif.Model ? " " + exif.Model : ""}.`);

  if (peopleNames?.length) {
    parts.push(`People in photo: ${peopleNames.join(", ")}.`);
  } else if (faceCount > 0) {
    const emotionText = emotion && emotion !== "neutral" ? `, appearing ${emotion}` : "";
    parts.push(`${faceCount === 1 ? "One person" : `${faceCount} people`} visible${emotionText}.`);
  }

  if (exif?.latitude && exif?.longitude) {
    parts.push(`GPS: ${Number(exif.latitude).toFixed(4)}, ${Number(exif.longitude).toFixed(4)}.`);
  }

  return { description: parts.join(" "), needsRecaption };
}

/** Backward-compat wrapper — returns just the string */
export function buildDescriptionString(opts) {
  return buildDescription(opts).description;
}

export function updateDescriptionWithPeople(currentDesc, personNames) {
  let desc = (currentDesc ?? "").replace(/People in (?:this )?photo:[^.]+\./g, "").trim();
  if (personNames.length > 0) desc = (desc + ` People in photo: ${personNames.join(", ")}.`).trim();
  return desc;
}