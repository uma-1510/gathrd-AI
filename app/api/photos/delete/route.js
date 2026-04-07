import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

export async function DELETE(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { photoIds } = await req.json();

    if (!photoIds || photoIds.length === 0) {
      return NextResponse.json({ error: "No photo IDs provided" }, { status: 400 });
    }

    // Fetch photos from DB to get storage paths (ownership check baked in)
    const placeholders = photoIds.map((_, i) => `$${i + 1}`).join(', ');
    const result = await pool.query(
      `SELECT id, storage_path FROM photos WHERE id IN (${placeholders}) AND uploaded_by = $${photoIds.length + 1}`,
      [...photoIds, session.user.username]
    );

    const photos = result.rows;

    if (photos.length === 0) {
      return NextResponse.json({ error: "No photos found" }, { status: 404 });
    }

    // ── Try to delete from Supabase Storage (best-effort, never blocks DB delete) ──
    const storagePaths = photos
      .filter(p => p.storage_path)
      .map(p => p.storage_path);

    if (storagePaths.length > 0) {
      try {
        const { default: supabaseAdmin } = await import("@/lib/supabaseAdmin");
        if (supabaseAdmin?.storage) {
          const { error: storageError } = await supabaseAdmin.storage
            .from("photos")
            .remove(storagePaths);
          if (storageError) {
            console.error("Storage delete error (non-fatal):", storageError);
          }
        } else {
          console.warn("supabaseAdmin.storage unavailable — skipping storage delete");
        }
      } catch (storageErr) {
        console.error("Storage delete threw (non-fatal):", storageErr.message);
      }
    }

    // ── Always delete from DB ─────────────────────────────────────────────────
    await pool.query(
      `DELETE FROM photos WHERE id IN (${placeholders}) AND uploaded_by = $${photoIds.length + 1}`,
      [...photoIds, session.user.username]
    );

    return NextResponse.json({ message: "Deleted successfully", count: photos.length });
  } catch (err) {
    console.error("Delete error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}