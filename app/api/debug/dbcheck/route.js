import { NextResponse } from "next/server";
import { embedTextCached, toSqlVector } from "@/lib/hf";
import pool from "@/lib/db";

export async function GET() {
  try {
    const queryText = "my birthday";
    const emb = await embedTextCached(queryText);
    const queryEmbedding = toSqlVector(emb);

    const result = await pool.query(
      `SELECT id, filename, ai_description,
        ROUND(((1 - (embedding <=> $2::vector)) * 100)::numeric, 1) AS similarity_pct,
        1 - (embedding <=> $2::vector) AS similarity
       FROM photos WHERE uploaded_by = $1 AND embedding IS NOT NULL
       ORDER BY similarity DESC LIMIT 5`,
      ["uma1234", queryEmbedding]
    );

    return NextResponse.json(result.rows.map(r => ({
      id: r.id,
      similarity: r.similarity,
      similarity_pct: r.similarity_pct,
      description: r.ai_description?.slice(0, 100),
    })));
  } catch (err) {
    return NextResponse.json({ error: err.message });
  }
}