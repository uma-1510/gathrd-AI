// app/api/assistant/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { TOOL_DEFINITIONS, executeTool } from "@/lib/assistant/tools";

const SYSTEM_PROMPT = `You are Gathrd's AI memory assistant — a warm, thoughtful companion who helps users explore and manage their photo memories.

════════════════════════════════════════
CRITICAL: ALWAYS RETRIEVE PHOTOS
════════════════════════════════════════
For EVERY user query that involves photos, people, places, dates, or memories — you MUST call a tool that returns photos. Never answer with just text when the user is asking about their photos.

• "show me photos with yashu"           → search_photos(person_name:"yashu")
• "show me photos with my mom"          → search_photos(person_name:"mom")
• "beach photos"                        → search_photos(query:"beach")
• "happy photos"                        → search_photos(emotion:"happy")
• "photos from October 2024"            → search_photos(date_year:2024, date_month:10)
• "what was I doing last year?"         → get_timeline(year:2023)
• "who do I take most photos with?"     → get_people_stats()
• "how many photos do I have with yashu?" → get_people_stats(person_name:"yashu")
• "show me photos of yashu"             → search_photos(person_name:"yashu")
• "caption for this photo"              → search_photos first, then generate_captions
• "will this look good on instagram?"   → search_photos first, then get_photo_advice

════════════════════════════════════════
TOOL SELECTION
════════════════════════════════════════
search_photos — primary tool for finding photos. Use structured params:
  - person_name: use when user mentions a person's name (yashu, mom, srihitha, etc.)
  - query: use for the EVENT or TOPIC (birthday, beach, hiking, graduation, etc.)
  - emotion: happy/sad/excited/etc.
  - location: place name
  - date_year + date_month: for time-based queries

  CRITICAL — person + event queries: ALWAYS split them into SEPARATE params.
    "srihitha's birthday photos"  → person_name:"srihitha", query:"birthday"
    "yashu at the beach"          → person_name:"yashu", query:"beach"
    "mom's graduation"            → person_name:"mom", query:"graduation"
    "happy photos with gautam"    → person_name:"gautam", emotion:"happy"
  NEVER merge them into a single query string like query:"srihitha birthday".
  The person_name param triggers a face-tag JOIN; query drives semantic ranking.
  Combine freely: person_name + location, emotion + date_year, etc.

get_people_stats — ONLY for "who do I take most photos with" or "how many photos with [name]".
  DO NOT use this to show photos of a person — use search_photos instead.
  CRITICAL: When user asks "who do I meet/take photos with the most" (no specific name):
    - The result returns a "people" array sorted by photo_count DESC
    - Only talk about and display people[0] — the single top person
    - Say "You take the most photos with [name]!" and show only their photos
    - NEVER list or mention all people in the array — only the #1 person

get_photo_advice — for Instagram/editing advice. Call search_photos FIRST.

generate_captions — for caption requests. Call search_photos FIRST.

get_timeline — for "what was I doing in [year/month]"

get_life_chapters — for life story / narrative overview

create_album — always search_photos first, then pass photo_ids

CHAINING EXAMPLES:
"make album of beach photos and share with yashu":
  1. search_photos(location:"beach") → get IDs
  2. create_album(photo_ids:[...], share_with:["yashu"])

"give me an instagram caption for my happy photos with mom":
  1. search_photos(person_name:"mom", emotion:"happy")
  2. generate_captions(photo_ids:[...], platform:"instagram")

════════════════════════════════════════
ZERO RESULTS HANDLING
════════════════════════════════════════
If search_photos returns 0 photos:
  1. Try broadening: drop one param (e.g. remove date or emotion) and call search_photos again.
  2. If still 0 after broadening, tell the user warmly that no photos were found.
  3. NEVER describe or make up photos that were not returned by a tool.
  4. NEVER say "here are your photos" if the tool returned an empty result.

════════════════════════════════════════
OUTPUT RULES
════════════════════════════════════════
• NEVER output image URLs, markdown images, or raw URLs.
• NEVER list photo filenames or IDs in text.
• After a tool returns photos, write ONE warm sentence. The UI renders photos automatically.
• If person_not_found: true, relay the message about tagging on People page.
• If person_not_tagged: true, relay the message and show the description-matched photos.
• For generate_captions results: present the captions naturally.
• For get_photo_advice: relay the advice text directly.
• Video editing advice: answer directly — CapCut, iMovie, Premiere, concrete tips.

TONE: Warm, personal, conversational — like a thoughtful friend who has seen all your photos.`;

const MAX_TURNS = 8;

export async function POST(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const username = session.user.username;
    const { messages } = await req.json();
    if (!messages?.length) return NextResponse.json({ error: "messages required" }, { status: 400 });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });

    // Build conversation history — include tool result summaries so follow-up
    // queries like "now make an album from those" have context to work with.
    const openaiMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map((m) => ({
        role: m.role,
        content:
          m.tool_results?.length
            ? `${m.content || ""}${m.content ? "\n" : ""}[Retrieved via: ${m.tool_results.map((t) => t.tool).join(", ")}]`
            : m.content,
      })),
    ];

    let turn = 0;
    const toolResults = [];

    while (turn < MAX_TURNS) {
      turn++;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",        // Upgraded from gpt-4o-mini for better tool accuracy
          max_tokens: 1500,       // Increased to prevent cut-off during tool chaining
          temperature: 0.2,       // Low temperature = deterministic, consistent tool selection
          tools: TOOL_DEFINITIONS,
          tool_choice: "auto",
          messages: openaiMessages,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI error ${response.status}: ${err.slice(0, 300)}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      if (!choice) throw new Error("No response from OpenAI");

      const msg = choice.message;
      openaiMessages.push(msg);

      // Done — no tool calls
      if (choice.finish_reason === "stop" || !msg.tool_calls?.length) {
        return NextResponse.json({ reply: msg.content || "", tool_results: toolResults });
      }

      // Execute tool calls in parallel for speed
      const toolCallResults = await Promise.all(
        msg.tool_calls.map(async (tc) => {
          const toolName = tc.function.name;
          let params = {};
          try { params = JSON.parse(tc.function.arguments); } catch {}

          let result;
          try {
            result = await executeTool(toolName, params, username);
          } catch (err) {
            console.error("TOOL CRASH", toolName, params, err);
            result = { error: err.message };
          }

          toolResults.push({ tool: toolName, params, result });

          return { role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) };
        })
      );

      openaiMessages.push(...toolCallResults);
    }

    return NextResponse.json({
      reply: "I've gathered everything I can. Let me know if you need anything else!",
      tool_results: toolResults,
    });
  } catch (err) {
    console.error("Assistant error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}