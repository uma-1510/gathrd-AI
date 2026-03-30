// app/api/agent/route.js
// The agent loop. Stateless per request — all state lives in conversation_history
// sent by the client. This lets the frontend resume after confirmations or errors.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import supabaseAdmin from "@/lib/supabaseAdmin";
import { TOOL_DEFINITIONS } from "@/lib/agent/tools";
import { EXECUTORS } from "@/lib/agent/executor";

const MAX_ITERATIONS = 12; // Hard ceiling — prevents runaway loops on edge cases

function buildSystemPrompt(username, today) {
  return `You are Gathrd AI — the personal photo assistant for ${username}.
You have direct access to their photo library, albums, people, and sharing settings.

## Your job
Complete the user's request autonomously using tools. Think step by step.
For multi-step tasks, chain tools: search first, then act on results.

## Response formatting — critical
- Never include image URLs, markdown image syntax ![...](...), or raw URLs in your responses.
- Never use markdown bold (**text**) or headers (##).
- Write in plain conversational sentences only.
- When listing people, just write their name and photo count naturally: "Gautam — 3 photos"
- Keep responses concise. One short paragraph or a simple list. No fluff.
- If you created or modified something, just confirm it clearly: "Done — I created the album and shared it with marco."

## Rules you must never break
1. Before ANY delete, bulk-edit, or action affecting 20+ photos: call ask_user_confirmation first.
2. Never delete photos uploaded by other users — only the owner can delete their own photos.
3. If a tool returns an error, try to recover (e.g. broaden a search) before giving up.
4. If you cannot complete a task, explain exactly why and what the user can do.
5. Be specific in your final message: tell the user what you did, how many photos, which albums.

## Context
Today: ${today}
User: ${username}`;
}

export async function POST(req) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const username = session.user.username;
  const ctx = { username, pool, supabaseAdmin };

  const body = await req.json();
  const {
    message,                    // Current user message
    conversation_history = [],  // Full prior conversation (sent by client)
  } = body;

  if (!message?.trim()) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  // Build messages array: system + full history + new user message
  const messages = [
    ...conversation_history,
    { role: "user", content: message },
  ];

  const steps = [];       // What the agent did — shown in the UI
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // ── Call OpenAI ────────────────────────────────────────────────────────
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 1500,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        messages: [
          { role: "system", content: buildSystemPrompt(username, new Date().toISOString().split("T")[0]) },
          ...messages,
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ error: "OpenAI error", details: err }, { status: 500 });
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) return NextResponse.json({ error: "No response from model" }, { status: 500 });

    const assistantMsg = choice.message;
    messages.push(assistantMsg); // Keep history consistent

    // ── Case 1: LLM wants to call tools ───────────────────────────────────
    if (choice.finish_reason === "tool_calls" && assistantMsg.tool_calls?.length) {

      for (const toolCall of assistantMsg.tool_calls) {
        const name = toolCall.function.name;
        let params;

        try {
          params = JSON.parse(toolCall.function.arguments);
        } catch {
          params = {};
        }

        // Execute
        const executor = EXECUTORS[name];
        const result = executor
          ? await executor(params, ctx)
          : { error: `Unknown tool: ${name}` };

        // Track step for UI
        steps.push({ tool: name, params, result });

        // ── Confirmation required — pause loop, return to client ───────────
        if (result?.__type === "CONFIRMATION_REQUIRED") {
          return NextResponse.json({
            status: "needs_confirmation",
            confirmation: {
              message: result.message,
              action_preview: result.action_preview,
              severity: result.severity,
            },
            steps,
            // Client must send this back with confirmed=true to resume
            conversation_history: messages,
          });
        }

        // Feed result back to LLM
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      // Loop — LLM reads results and decides next action
      continue;
    }

    // ── Case 2: LLM is done ────────────────────────────────────────────────
    if (choice.finish_reason === "stop") {
      return NextResponse.json({
        status: "complete",
        message: assistantMsg.content,
        steps,
        conversation_history: messages, // Client stores this for follow-ups
      });
    }

    break; // Unexpected finish reason
  }

  return NextResponse.json({
    status: "error",
    message: "The agent couldn't complete this task. Try rephrasing your request.",
    steps,
    conversation_history: messages,
  });
}