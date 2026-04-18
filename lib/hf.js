// lib/hf.js

const HF_TOKEN = process.env.HUGGINGFACE_API_KEY;

// FIX 1: Removed the stray backtick at the end of the URL string
const HF_EMBED_URL = "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction";

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

export async function captionImage(imageBuffer) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const base64 = imageBuffer.toString("base64");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
          { type: "text", text: "Describe this photo in one detailed sentence for search indexing. Include: what is happening, how many people, their emotions and expressions, the setting and background, any notable objects (cake, balloons, decorations, food, pets, vehicles), and the occasion if obvious (birthday, wedding, graduation, beach trip, vacation, selfie, group photo, dinner, concert, etc). Be specific not generic. If you see text or signs, mention them." },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI Vision ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const caption = data.choices?.[0]?.message?.content;
  if (!caption) throw new Error("OpenAI Vision: no caption in response");
  return caption.trim();
}

// ── MiniLM-L6-v2: text → 384-dim embedding vector ───────────────────────────
// Input:  string (description, query, etc.)
// Output: number[] of length 384
export async function embedText(text) {
  if (!HF_TOKEN) throw new Error("HUGGINGFACE_API_KEY not set");

  // FIX 2: Use HF_EMBED_URL directly — old code was appending the model path
  // again on top of HF_BASE which already contained it, producing a broken URL
  const res = await hfFetch(
    HF_EMBED_URL,
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