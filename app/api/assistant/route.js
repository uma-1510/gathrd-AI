// app/api/assistant/route.js
// Unified AI assistant — replaces both /api/search and /api/agent.
// Uses GPT-4o with function calling. Runs an agentic loop (up to 6 turns).
// Returns a structured response the UI can render: text + photos + actions.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { TOOL_DEFINITIONS, executeTool } from "@/lib/assistant/tools";

const SYSTEM_PROMPT = `You are Gathrd's AI memory assistant. You help users explore and manage their photo memories.

CRITICAL OUTPUT RULES — these override everything else:
- NEVER output image URLs, markdown images (![...](url)), or raw URLs of any kind.
- NEVER describe or list individual photos in your text. The UI renders them automatically from tool results.
- After calling a tool that returns photos, just write a warm natural sentence about what you found. Do NOT reference specific photos, filenames, or URLs.
- For people stats: say something like "You take the most photos with Yashu! Here are some highlights." — then stop. Don't list photos.
- If search_photos returns resolved_people in its result, mention who was found by name (e.g. "Found photos with Mom and Yashu"). If resolved_people is empty and it was a family query, tell the user they need to tag people in the People page first.
- If search_photos returns a no_together_message field, relay that message exactly to the user.

TOOL USAGE:
- Always use tools to fetch real data — never make up photo counts or descriptions.
- For "tell me about my year/life", call get_timeline or get_life_chapters.
- For destructive actions (delete), describe what you'll do and ask for confirmation first. Never call delete_photos without explicit user confirmation.

TONE: Warm, personal, conversational — like a thoughtful friend who has seen all your photos.`;


const MAX_TURNS = 6;

export async function POST(req) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const username = session.user.username;
    const { messages } = await req.json();

    if (!messages?.length) {
      return NextResponse.json({ error: "messages required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });

    // Build message history for OpenAI
    const openaiMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages,
    ];

    // ── Agentic loop ──────────────────────────────────────────────────────────
    let turn = 0;
    const toolResults = []; // collect all tool results to return to UI

    while (turn < MAX_TURNS) {
      turn++;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          max_tokens: 1500,
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
      const message = choice?.message;

      if (!message) throw new Error("No message in OpenAI response");

      // Add assistant message to history
      openaiMessages.push(message);

      // ── No tool calls → we're done, return the text response ─────────────
      if (!message.tool_calls?.length || choice.finish_reason === "stop") {
        return NextResponse.json({
          reply: message.content || "",
          tool_results: toolResults,
          turns: turn,
        });
      }

      // ── Execute all tool calls in this turn ───────────────────────────────
      const toolCallResults = await Promise.all(
        message.tool_calls.map(async (toolCall) => {
          const toolName = toolCall.function.name;
          let params = {};
          try { params = JSON.parse(toolCall.function.arguments); } catch {}

          const result = await executeTool(toolName, params, username);

          // Track for UI rendering
          toolResults.push({
            tool: toolName,
            params,
            result,
          });

          return {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          };
        })
      );

      // Add all tool results to history for next turn
      openaiMessages.push(...toolCallResults);
    }

    // Hit max turns — return whatever we have
    return NextResponse.json({
      reply: "I've gathered the information. Here's what I found.",
      tool_results: toolResults,
      turns: turn,
    });
  } catch (err) {
    console.error("Assistant error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}