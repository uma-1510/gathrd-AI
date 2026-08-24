# Gathrd

**An AI photo memory platform. You don't organize your library, you talk to it.**

Gathrd is a full-stack photo management app where an AI agent sits in front of your
photo library instead of a search bar. Upload photos, and Gathrd automatically
understands what's in them: who's there, the mood, the place, the occasion. It
indexes all of it for instant retrieval. From there, you manage your entire
library by talking to an in-app AI assistant: search, tag, organize into albums,
find duplicates, build highlight reels, generate captions, and share, all through
one chat interface.

---

## Why

AI has changed almost every category of software (it writes code, drafts copy,
edits video), but photo management is still stuck where it was a decade ago:
scroll through thousands of thumbnails and search by filename or date. Gathrd
applies the same shift to your photo library. It's built for individuals and
small groups: a family archive, a single event, a shared album with friends.

---

## What it does

- **Understands every photo on upload:** captions, faces, mood, location, and
  event type get extracted automatically. No manual tagging required.
- **Semantic + filtered search:** "beach vacation," "photos with mom," "happy
  photos from last summer," all combinable.
- **People tagging:** faces are detected and matched against a library of
  named people, so search and stats can filter by person.
- **Albums & groups:** create, share, and co-manage albums with role-based
  membership and comments.
- **Map view:** every geotagged photo plotted by location.
- **Auto-generated memories:** monthly recap cards and year-in-review
  summaries built from your best, most emotionally memorable shots.
- **Duplicate detection:** flags near-identical photos and recommends which
  copy to keep.
- **Highlight reels:** auto-assembled video reels scored by emotion, faces,
  and resolution, with mood-matched background music.
- **Social captions:** AI-generated captions tailored per platform
  (Instagram, LinkedIn, Twitter/X, Threads).
- **One AI assistant that does all of it:** a conversational agent with tool
  access to the whole feature set above.

---

## The processing pipeline

This is the most complex part of the system. Everything else (search, the
agent, memories, reels) depends on the data this pipeline produces. It runs
automatically the moment a photo is uploaded, before the user ever asks a
question.

```
Upload
  │
  ├─ EXIF extraction (exifr)                             → capture date, GPS coordinates, camera info
  ├─ Reverse geocoding (OpenStreetMap)                   → GPS to human-readable place name
  ├─ Vision captioning (OpenAI GPT-4o-mini)              → one detailed sentence describing what's happening, who's in it, expressions, setting,
                                                        occasion
  ├─ Event enrichment                                    → caption keywords ("cake," "bouquet") get
                                                       mapped to searchable event phrases ("birthday celebration," "wedding")
  ├─ Face detection & matching (face-api.js)             → faces are detected client-side,
                                                       compared by Euclidean distance against the user's tagged People library
  ├─ Text embedding (HuggingFace sentence-transformers, 384-dim)   → the enriched description is embedded and stored in Postgres via
                                                                     pgvector, making it semantically searchable
  └─ Content scoring                                      → a 0–100 score from emotion, face count, resolution, location, and description
                                                           richness, used to surface "best" photos automatically
  │
  ▼
Photo is now fully searchable, taggable, and eligible for memories/reels
```

Every one of those signals (the caption, the enriched description, the
embedding, the face matches, the score) is what the AI assistant reads from
when a user later asks it a question. Nothing is computed on demand. It's
all pre-indexed at upload time so the assistant can respond in real time.

---

## The AI assistant

The assistant works as a tool-using agent: it takes multiple turns per
request, calling real functions against the database, rather than answering
off a single prompt. It runs a turn-based loop (up to 5 turns per request)
against OpenAI's function-calling API, backed by a purpose-built set of
tools that query the user's real data directly:

| Tool | What it does |
|---|---|
| `search_photos` | primary retrieval: by person, place, date, emotion, semantic query |
| `get_album` / `list_albums` / `create_album` / `share_album` | album management |
| `find_duplicates` | flags near-duplicate photos by embedding similarity |
| `delete_photos` | deletes only photos the requesting user owns |
| `get_people_stats` | who you're photographed with most, tagged-person analytics |
| `build_highlight_reel` | scores and selects photos for a reel, optionally by person |
| `generate_captions` | platform-specific social captions |
| `prepare_download` | packages accessible photos for a zip export |
| `ask_user_confirmation` | pauses the loop for explicit user confirmation before a destructive action |

**How a request flows:** a user message comes in, the model is forced to
call a tool on the first turn (so it never invents an answer instead of
retrieving one), the tool queries Postgres directly, scoped to that user,
the real result gets handed back to the model, and the model writes one
short reply summarizing what was found while the app's UI renders the
actual photos.

The design choice here was deliberate. Rather than build another wrapper
that asks a model to "figure out" the answer, the app does all of the actual
work itself (the database queries, the face matching, the retrieval, the
ownership checks) and only sends OpenAI the real, already-verified context
to reason over and summarize in plain language. OpenAI's job is narrow: turn
verified data into a short, natural sentence. It never guesses at what's in
the library.

### Why not MCP

We deliberately did not build this on the Model Context Protocol. Routing
the agent's access to a user's own photo library out through MCP would add
a layer of indirection and infrastructure that this use case doesn't need.
The assistant already lives inside the same app as the data it's querying,
with direct, authenticated database access. Going through MCP here would be
solving a multi-client, cross-service integration problem that Gathrd
doesn't have. It's a reasonable next step if Gathrd ever needs to expose
the photo library to *external* agents (letting Claude Desktop query your
library directly, for example), but that's a different product surface
than the in-app assistant.

---

## Tech stack

- **Framework:** Next.js 16 (App Router), React 19
- **Auth:** NextAuth v5 (credentials + Google OAuth), bcrypt password hashing,
  signed session cookies, protected-route middleware
- **Database:** Postgres via Supabase, with `pgvector` for embedding search
- **Storage:** Supabase Storage (signed URLs for photo/video delivery)
- **AI / ML:**
  - OpenAI GPT-4o-mini: vision captioning, the assistant's function-calling loop, social captions
  - HuggingFace `sentence-transformers/all-MiniLM-L6-v2`: 384-dim text embeddings
  - face-api.js: client-side face detection and descriptor extraction
- **Other:** `exifr` (EXIF parsing), OpenStreetMap Nominatim (reverse geocoding),
  `resend` / `nodemailer` (transactional email), `jszip` + `file-saver` (album downloads)

---

## Core data model (inferred from schema usage)

- `users`: accounts, credentials
- `photos`: file metadata, EXIF/GPS, AI description, embedding, emotion,
  face count, content score
- `people` / `photo_people` / `face_tags`: named people and their photo links
- `albums` / `album_photos` / `album_members` / `shared_albums`: albums and sharing
- `groups`: multi-user collections of albums
- `memories`: auto-generated monthly/annual recap records
- `music_tracks`: mood-tagged tracks for highlight reels

---

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin (server-side storage/DB ops) |
| `AUTH_SECRET` / `NEXTAUTH_URL` | NextAuth session signing |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth login |
| `OPENAI_API_KEY` | vision captioning + AI assistant |
| `HUGGINGFACE_API_KEY` | text embeddings |
| `EMAIL_SERVER_USER` / `EMAIL_SERVER_PASS` | password reset email delivery |
| `NEXT_PUBLIC_APP_URL` | public base URL |

---

## Getting started

```bash
npm install
# set up .env.local with the variables above
npm run dev
```

### Auth flow

```
Signup (POST /api/auth/signup)
  → validate + hash password → insert into users table
  → redirect to Login
Login (POST /api/auth/callback/credentials)
  → auth.js verifies credentials → NextAuth session created
  → session cookie set (authjs.session-token)
Protected routes
  → middleware reads the session cookie
  → logged in → allow; not logged in → redirect to /login
```

---

## Roadmap

- Optional MCP server exposing the photo library to external MCP clients
  (Claude Desktop, Claude Code) as a separate integration surface from the
  in-app assistant
- Background job queue for heavier processing at scale
- Expanded highlight-reel and video pipeline

