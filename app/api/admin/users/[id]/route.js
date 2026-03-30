import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import getSupabaseAdmin from "@/lib/supabaseAdmin";

export async function GET(req, { params }) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const user = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    if (user.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const photos = await pool.query(
      "SELECT * FROM photos WHERE uploaded_by = $1 ORDER BY uploaded_at DESC",
      [user.rows[0].username]
    );

    return NextResponse.json({ user: user.rows[0], photos: photos.rows });
  } catch (err) {
    console.error("Admin get user error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    // Get user info
    const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const user = userResult.rows[0];

    // Get all photos to delete from storage
    const photos = await pool.query(
      "SELECT * FROM photos WHERE uploaded_by = $1",
      [user.username]
    );

    // Delete from Supabase Storage
    const storagePaths = photos.rows
      .filter(p => p.storage_path)
      .map(p => p.storage_path);

    if (storagePaths.length > 0) {
      await getSupabaseAdmin.storage.from("photos").remove(storagePaths);
    }

    // Delete user (cascades to photos, albums, album_photos)
    await pool.query("DELETE FROM photos WHERE uploaded_by = $1", [user.username]);
    await pool.query("DELETE FROM albums WHERE created_by = $1", [user.username]);
    await pool.query("DELETE FROM users WHERE id = $1", [id]);

    return NextResponse.json({ message: "User deleted successfully" });
  } catch (err) {
    console.error("Admin delete user error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}