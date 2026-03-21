import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabaseAdmin from "@/lib/supabaseAdmin";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";
import sharp from "sharp";
import * as exifr from "exifr";

export async function POST(req) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await initDb();

    const formData = await req.formData();
    const files = formData.getAll("photos");

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    let userId = null;
    if (session.user.username !== "admin") {
      const result = await pool.query(
        "SELECT id FROM users WHERE username = $1",
        [session.user.username]
      );
      userId = result.rows[0]?.id || null;
    }

    const uploadedPhotos = [];

    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const filename = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
      const path = `${session.user.username}/${filename}`;

      let imageMeta = {};
      let exifMeta = {};

      try {
        imageMeta = await sharp(buffer).metadata();
      } catch (err) {
        console.error("Sharp metadata error:", err);
      }

      try {
        exifMeta = await exifr.parse(buffer, { gps: true });
      } catch (err) {
        console.error("EXIF parse error:", err);
      }

      const { error: uploadError } = await supabaseAdmin.storage
        .from("photos")
        .upload(path, buffer, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        continue;
      }

      const { data: signedData, error: signedError } = await supabaseAdmin.storage
        .from("photos")
        .createSignedUrl(path, 60 * 60 * 24 * 365);

      if (signedError) {
        console.error("Signed URL error:", signedError);
        continue;
      }

      const url = signedData.signedUrl;

      await pool.query(
        `INSERT INTO photos (
          user_id,
          filename,
          url,
          uploaded_by,
          storage_path,
          mime_type,
          file_size,
          width,
          height,
          format,
          date_taken,
          camera_make,
          camera_model,
          latitude,
          longitude
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15
        )`,
        [
          userId,
          filename,
          url,
          session.user.username,
          path,
          file.type || null,
          file.size || null,
          imageMeta.width || null,
          imageMeta.height || null,
          imageMeta.format || null,
          exifMeta?.DateTimeOriginal || null,
          exifMeta?.Make || null,
          exifMeta?.Model || null,
          exifMeta?.latitude || null,
          exifMeta?.longitude || null,
        ]
      );

      uploadedPhotos.push({
        filename,
        url,
        metadata: {
          width: imageMeta.width || null,
          height: imageMeta.height || null,
          format: imageMeta.format || null,
          date_taken: exifMeta?.DateTimeOriginal || null,
          camera_make: exifMeta?.Make || null,
          camera_model: exifMeta?.Model || null,
          latitude: exifMeta?.latitude || null,
          longitude: exifMeta?.longitude || null,
        },
      });
    }

    return NextResponse.json({ photos: uploadedPhotos }, { status: 201 });
  } catch (err) {
    console.error("Upload route error:", err);
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    );
  }
}