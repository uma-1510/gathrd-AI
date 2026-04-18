// app/api/photos/[id]/location/route.js
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

export async function PATCH(req, { params }) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Next.js 15+: params is a Promise
    const { id: photoId } = await params;
    const body = await req.json();
    const placeName = body.place_name;

    console.log("=== LOCATION PATCH ===");
    console.log("photoId:", photoId, "type:", typeof photoId);
    console.log("placeName:", placeName);
    console.log("session.user.username:", session.user.username);

    if (!placeName || !placeName.trim()) {
      return NextResponse.json({ error: "place_name required" }, { status: 400 });
    }

    // Check photo exists — no ownership filter yet, just find it
    const check = await pool.query(
      "SELECT id, uploaded_by FROM photos WHERE id = $1",
      [parseInt(photoId, 10)]
    );

    console.log("check.rows:", JSON.stringify(check.rows));

    if (!check.rows.length) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    const row = check.rows[0];
    const sessionIds = [
      session.user.username,
      session.user.email,
      session.user.name,
      session.user.id,
    ].filter(Boolean).map(v => String(v).toLowerCase());

    const uploadedBy = String(row.uploaded_by || "").toLowerCase();
    console.log("sessionIds:", sessionIds, "uploadedBy:", uploadedBy);

    if (!sessionIds.includes(uploadedBy)) {
      console.log("OWNERSHIP MISMATCH");
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Run the update
    const updateResult = await pool.query(
      "UPDATE photos SET place_name = $1 WHERE id = $2 RETURNING id, place_name",
      [placeName.trim(), parseInt(photoId, 10)]
    );

    console.log("UPDATE result:", JSON.stringify(updateResult.rows));

    if (!updateResult.rows.length) {
      console.log("UPDATE matched 0 rows!");
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    return NextResponse.json({
      message: "Location updated",
      place_name: updateResult.rows[0].place_name,
      id: updateResult.rows[0].id,
    });

  } catch (err) {
    console.error("PATCH location error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}