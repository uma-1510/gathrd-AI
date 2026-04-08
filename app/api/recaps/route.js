import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";
import supabaseAdmin from "@/lib/supabaseAdmin";

function getPossibleOwners(session) {
  return [
    session?.user?.username,
    session?.user?.email,
    session?.user?.name,
    session?.user?.id,
  ]
    .filter(Boolean)
    .map((v) => String(v));
}

function rowMatchesOwner(row, owners) {
  const candidates = [
    row.user_id,
    row.username,
    row.email,
    row.owner,
  ]
    .filter(Boolean)
    .map((v) => String(v));

  return owners.some((owner) => candidates.includes(owner));
}

function isValidStoragePath(value) {
  return !!value && typeof value === "string" && !value.startsWith("http");
}

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await initDb();

    const owners = getPossibleOwners(session);

    const result = await pool.query(`
      SELECT *
      FROM recaps
      ORDER BY updated_at DESC NULLS LAST, id DESC
    `);

    const ownedRecaps = result.rows.filter((row) => rowMatchesOwner(row, owners));

    const recaps = await Promise.all(
      ownedRecaps.map(async (recap) => {
        if (!isValidStoragePath(recap.storage_path)) {
          return { ...recap, url: recap.url || null };
        }

        try {
          const { data, error } = await supabaseAdmin.storage
            .from("recaps")
            .createSignedUrl(recap.storage_path, 60 * 60 * 24 * 30);

          if (error || !data?.signedUrl) {
            return { ...recap, url: recap.url || null };
          }

          return { ...recap, url: data.signedUrl };
        } catch {
          return { ...recap, url: recap.url || null };
        }
      })
    );

    return NextResponse.json({ recaps });
  } catch (err) {
    console.error("GET RECAPS ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}