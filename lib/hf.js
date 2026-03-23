// ── Hugging Face API — all model calls go through here ────────────────────────
// Models used:
//   Vision:     Salesforce/blip-image-captioning-large  (image → caption)
//   Embeddings: sentence-transformers/all-MiniLM-L6-v2  (text → 384-dim vector)
//
// Both are free via HF Serverless Inference API with your HF token.
// Rate limits: ~300-500 req/hour per model. Plenty for personal use.

const HF_TOKEN = process.env.HUGGINGFACE_API_KEY;
const HF_BASE  = "https://router.huggingface.co/hf-inference/models";

// Retry helper — HF models cold-start and return 503 briefly
async function hfFetch(url, options, retries = 3, delayMs = 4000) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, options);

    if (res.ok) return res;

    const body = await res.text();

    // Model loading — wait and retry
    if (res.status === 503 && body.includes("loading")) {
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
    }

    throw new Error(`HF API ${res.status}: ${body.slice(0, 300)}`);
  }
  throw new Error("HF API: max retries exceeded");
}

// ── BLIP: image → natural language caption ────────────────────────────────────
// Input:  imageBuffer (Buffer)
// Output: string like "a woman blowing out birthday candles with friends"
export async function captionImage(imageBuffer) {
  if (!HF_TOKEN) throw new Error("HUGGINGFACE_API_KEY not set");

  const res = await hfFetch(
    `${HF_BASE}/Salesforce/blip-image-captioning-large`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/octet-stream",
      },
      body: imageBuffer,
    }
  );

  const data = await res.json();
  const caption = Array.isArray(data)
    ? data[0]?.generated_text
    : data?.generated_text;

  if (!caption) throw new Error(`BLIP: no caption in response: ${JSON.stringify(data)}`);
  return caption.trim();
}

// ── MiniLM-L6-v2: text → 384-dim embedding vector ───────────────────────────
// Input:  string (description, query, etc.)
// Output: number[] of length 384
export async function embedText(text) {
  if (!HF_TOKEN) throw new Error("HUGGINGFACE_API_KEY not set");

  const res = await hfFetch(
    `${HF_BASE}/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
    }
  );

  const data = await res.json();

  // Response is either a flat array [0.1, 0.2, ...] or nested [[0.1, 0.2, ...]]
  const vector = Array.isArray(data[0]) ? data[0] : data;

  if (!Array.isArray(vector) || vector.length !== 384) {
    throw new Error(`MiniLM: unexpected response shape. Got: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return vector;
}

// ── Convert embedding array → pgvector SQL literal ───────────────────────────
// e.g. [0.1, 0.2, ...] → '[0.1,0.2,...]'
export function toSqlVector(embedding) {
  return `[${embedding.join(",")}]`;
}

// ── Simple in-process cache for query embeddings ─────────────────────────────
// Avoids re-embedding the same search query on repeated searches
const _cache = new Map();
export async function embedTextCached(text) {
  const key = text.toLowerCase().trim();
  if (_cache.has(key)) return _cache.get(key);
  const vec = await embedText(text);
  if (_cache.size > 200) _cache.delete(_cache.keys().next().value); // LRU evict
  _cache.set(key, vec);
  return vec;
}