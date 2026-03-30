// lib/agent/tools.js
// Single source of truth for every tool the agent can call.
// Shape matches OpenAI function calling spec exactly.

export const TOOL_DEFINITIONS = [

  {
    type: "function",
    function: {
      name: "search_photos",
      description: `Search the user's own photo library. Supports location (place_name or ai_description), 
person name (tagged faces), relative or absolute dates, and semantic description. 
Always call this first when you need to identify a set of photos before acting on them.
Returns photo IDs, URLs, metadata. Max 200 results.`,
      parameters: {
        type: "object",
        properties: {
          location:    { type: "string",  description: "City, country, venue, or vague place. e.g. 'Italy', 'beach', 'grandma's house'" },
          person_name: { type: "string",  description: "Full or partial name of a tagged person" },
          days_ago:    { type: "number",  description: "Photos from the last N days" },
          date_from:   { type: "string",  description: "ISO date e.g. '2024-06-01'" },
          date_to:     { type: "string",  description: "ISO date e.g. '2024-08-31'" },
          semantic:    { type: "string",  description: "Free-text semantic description e.g. 'smiling at dinner', 'sunset on the water'" },
          limit:       { type: "number",  description: "Max results, default 100" },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "get_album",
      description: `Get all photos and members of a specific album the user owns or has access to.
Use fuzzy name matching when the user says 'the Italy album' or 'our family album'.
Returns album_id, photo list, member usernames, and ownership info.`,
      parameters: {
        type: "object",
        properties: {
          album_name: { type: "string", description: "Album name, fuzzy matched" },
          album_id:   { type: "number", description: "Exact album ID if known" },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "list_albums",
      description: "List all albums the user owns or has access to. Use when user says 'my albums' or you need to find an album by browsing.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "create_album",
      description: "Create a new album and optionally add photos and share with users in one step.",
      parameters: {
        type: "object",
        properties: {
          name:       { type: "string",                        description: "Album name" },
          description:{ type: "string",                        description: "Optional description" },
          photo_ids:  { type: "array", items: { type: "number" }, description: "Photo IDs to add" },
          share_with: { type: "array", items: { type: "string" }, description: "Usernames to share with immediately" },
        },
        required: ["name"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "share_album",
      description: "Share an existing album with one or more users by username.",
      parameters: {
        type: "object",
        properties: {
          album_id:   { type: "number",                        description: "ID of the album to share" },
          share_with: { type: "array", items: { type: "string" }, description: "Usernames to share with" },
        },
        required: ["album_id", "share_with"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "ask_user_confirmation",
      description: `MUST be called before any destructive or irreversible action: deleting photos, 
bulk modifications, or any action affecting more than 20 photos at once.
This pauses execution and shows the user a confirmation dialog.
Describe exactly what you're about to do and why.`,
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Plain-English summary of what will happen" },
          action_preview: { type: "string", description: "Specifics: count, names, IDs affected" },
          severity: { type: "string", enum: ["low", "medium", "high"], description: "low=reversible, high=permanent" },
        },
        required: ["message", "severity"],
      },
    },
  },
  // ── PHASE 2 TOOLS — append inside TOOL_DEFINITIONS array ─────────────────────

  {
    type: "function",
    function: {
      name: "find_duplicates",
      description: `Find near-duplicate photos within a set of photo IDs using vector embedding similarity.
Use this when user says "delete duplicates", "clean up", "remove copies", or "find similar photos".
Always call get_album or search_photos first to get the photo_ids pool, then pass them here.
Returns pairs sorted by similarity score descending. Always show the user what was found before deleting.`,
      parameters: {
        type: "object",
        properties: {
          photo_ids: {
            type: "array",
            items: { type: "number" },
            description: "Pool of photo IDs to scan for duplicates",
          },
          threshold: {
            type: "number",
            description: "Similarity 0–1. 0.97 = nearly identical, 0.90 = very similar. Default 0.95.",
          },
        },
        required: ["photo_ids"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "delete_photos",
      description: `Permanently delete photos by ID from storage and database.
CRITICAL RULES:
1. You MUST call ask_user_confirmation before this — no exceptions.
2. Only pass photo IDs that belong to the current user (uploaded_by = username).
3. Never delete photos from shared albums that were uploaded by other members.
The API enforces ownership — non-owned photos are silently skipped and reported back.`,
      parameters: {
        type: "object",
        properties: {
          photo_ids: {
            type: "array",
            items: { type: "number" },
            description: "IDs of photos to permanently delete",
          },
        },
        required: ["photo_ids"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "get_people_stats",
      description: `Analyse who appears most frequently in the user's photos.
Use for queries like "who do I meet most", "who am I with most often", "show my closest people".
Returns people ranked by photo count with optional date filtering.
Only returns people the user has explicitly tagged/named — not anonymous faces.`,
      parameters: {
        type: "object",
        properties: {
          top_n: {
            type: "number",
            description: "Number of top people to return. Default 10.",
          },
          days_ago: {
            type: "number",
            description: "Limit analysis to photos from last N days. Omit for all-time.",
          },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "build_highlight_reel",
      description: `Select the best photos from a pool to create a highlight or memory reel.
Scoring: happy/excited emotion (+5), faces present (+3), high resolution (+res bonus), sad/angry (−penalty).
Use for: "create a memory", "highlight reel", "best photos of X", "make a recap".
Call search_photos or get_album first to get the pool, then call this to get the ranked selection,
then call create_album to save the result.`,
      parameters: {
        type: "object",
        properties: {
          photo_ids: {
            type: "array",
            items: { type: "number" },
            description: "Pool of candidate photo IDs to select from",
          },
          count: {
            type: "number",
            description: "How many highlights to pick. Default 20, max 50.",
          },
          focus_person: {
            type: "string",
            description: "If set, boost photos containing this person name. Uses photo_people join.",
          },
        },
        required: ["photo_ids"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "prepare_download",
      description: `Prepare a set of photos for download by returning their URLs and filenames.
The client will use jszip + file-saver to build the zip in the browser.
Use when user says "download", "save to my computer", "export", "get these photos".
Returns photo metadata — the actual zip is built client-side after this response.`,
      parameters: {
        type: "object",
        properties: {
          photo_ids: {
            type: "array",
            items: { type: "number" },
            description: "Photo IDs to include in the download",
          },
          zip_name: {
            type: "string",
            description: "Filename for the zip without extension. e.g. 'Italy Trip 2024'",
          },
        },
        required: ["photo_ids"],
      },
    },
  },

];



// Tool names as a typed set — used for validation in executor
export const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map(t => t.function.name));