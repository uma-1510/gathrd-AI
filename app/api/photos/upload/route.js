import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabaseAdmin from "@/lib/supabaseAdmin";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";
import sharp from "sharp";
import * as exifr from "exifr";
import { captionImage, embedText, toSqlVector } from "@/lib/hf";
import { buildDescription } from "@/lib/description";
import { matchFaceToPeople } from "@/lib/faceMatcher";
import { addPhotoToLocationAlbum } from "@/lib/locationAlbum";

const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-matroska",
  "video/mpeg",
]);

const VIDEO_EXTENSIONS = /\.(mp4|mov|avi|webm|mkv|mpeg|mpg)$/i;

function isVideo(file) {
  return VIDEO_MIME_TYPES.has(file.type) || VIDEO_EXTENSIONS.test(file.name || "");
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { "User-Agent": "gathrd-photo-app/1.0" } }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const a = data.address || {};

    return (
      [a.city || a.town || a.village || a.county, a.state, a.country]
        .filter(Boolean)
        .join(", ") || null
    );
  } catch {
    return null;
  }
}

function buildVideoDescription(filename) {
  const cleanName = String(filename || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]/g, " ")
    .replace(/\d{13}[-_]?/g, "")
    .trim();

  return `A video clip${cleanName ? `: ${cleanName}` : ""}.`;
}

function getVideoMimeType(file) {
  const ext = String(file.name || "").split(".").pop()?.toLowerCase() || "";

  return (
    file.type ||
    {
      mp4: "video/mp4",
      mov: "video/quicktime",
      avi: "video/x-msvideo",
      webm: "video/webm",
      mkv: "video/x-matroska",
      mpeg: "video/mpeg",
      mpg: "video/mpeg",
    }[ext] ||
    "video/mp4"
  );
}

function safeFileSize(file) {
  try {
    return typeof file.size === "number" && file.size > 0 ? file.size : null;
  } catch {
    return null;
  }
}

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await initDb();

    const formData = await req.formData();
    const files = formData.getAll("photos");
    const faceResultsRaw = formData.get("faceResults");

    if (!files?.length) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    let faceResultsMap = {};
    if (faceResultsRaw) {
      try {
        for (const r of JSON.parse(faceResultsRaw)) {
          faceResultsMap[r.name] = r;
        }
      } catch {
        faceResultsMap = {};
      }
    }

    let userId = null;
    if (session.user.username !== "admin") {
      try {
        const r = await pool.query(
          "SELECT id FROM users WHERE username = $1",
          [session.user.username]
        );
        userId = r.rows[0]?.id || null;
      } catch (err) {
        console.error("User lookup failed:", err);
      }
    }

    const uploadedPhotos = [];

    for (const file of files) {
      try {
        const bytes = await file.arrayBuffer();
        const rawBuffer = Buffer.from(bytes);
        const filename = `${Date.now()}-${String(file.name || "file").replace(/\s+/g, "_")}`;
        const storagePath = `${session.user.username}/${filename}`;

        if (isVideo(file)) {
          try {
            const mimeType = getVideoMimeType(file);

            const { error: uploadError } = await supabaseAdmin.storage
              .from("photos")
              .upload(storagePath, rawBuffer, {
                contentType: mimeType,
                upsert: false,
              });

            if (uploadError) {
              console.error("Video storage upload error:", uploadError.message);
              continue;
            }

            const { data: urlData } = supabaseAdmin.storage
              .from("photos")
              .getPublicUrl(storagePath);

            const url = urlData?.publicUrl || null;
            if (!url) {
              console.error("Video public URL missing");
              continue;
            }

            const description = buildVideoDescription(file.name);

            let embeddingValue = null;
            try {
              if (process.env.HUGGINGFACE_API_KEY) {
                const emb = await embedText(description);
                embeddingValue = toSqlVector(emb);
              }
            } catch (err) {
              console.error("Video embedding error:", err.message);
            }

            let inserted;
            try {
              inserted = await pool.query(
                `INSERT INTO photos (
                  user_id, filename, url, uploaded_by, storage_path,
                  mime_type, file_size,
                  ai_description, embedding, needs_recaption
                ) VALUES (
                  $1,$2,$3,$4,$5,
                  $6,$7,
                  $8,$9::vector,$10
                ) RETURNING id`,
                [
                  userId,
                  filename,
                  url,
                  session.user.username,
                  storagePath,
                  mimeType,
                  safeFileSize(file),
                  description,
                  embeddingValue,
                  false,
                ]
              );
            } catch (err) {
              console.error("Video DB insert failed:", err);
              continue;
            }

            uploadedPhotos.push({
              id: inserted.rows[0]?.id || null,
              filename,
              url,
              description,
              isVideo: true,
            });
          } catch (videoErr) {
            console.error("Video upload failed for", file.name, ":", videoErr.message);
          }

          continue;
        }

        let imageMeta = {};
        try {
          imageMeta = await sharp(rawBuffer).metadata();
        } catch (err) {
          console.error("Sharp metadata error:", err.message);
        }

        let uploadBuffer = rawBuffer;
        try {
          uploadBuffer = await sharp(rawBuffer)
            .rotate()
            .resize({
              width: 1600,
              height: 1600,
              fit: "inside",
              withoutEnlargement: true,
            })
            .jpeg({ quality: 85, progressive: true })
            .toBuffer();
        } catch (err) {
          console.error("Image compression error:", err.message);
        }

        let exif = {};
        try {
          exif = (await exifr.parse(rawBuffer, { gps: true })) ?? {};
        } catch (err) {
          console.error("EXIF parse error:", err.message);
        }

        let placeName = null;
        if (exif?.latitude && exif?.longitude) {
          placeName = await reverseGeocode(exif.latitude, exif.longitude);
        }

        const { error: uploadError } = await supabaseAdmin.storage
          .from("photos")
          .upload(storagePath, uploadBuffer, {
            contentType: "image/jpeg",
            upsert: false,
          });

        if (uploadError) {
          console.error("Photo storage upload error:", uploadError.message);
          continue;
        }

        const { data: urlData } = supabaseAdmin.storage
          .from("photos")
          .getPublicUrl(storagePath);

        const url = urlData?.publicUrl || null;
        if (!url) {
          console.error("Photo public URL missing");
          continue;
        }

        const faceData = faceResultsMap[file.name] || {};
        const faceCount = faceData.faceCount ?? 0;
        const emotion = faceData.dominantEmotion ?? null;
        const descriptor = faceData.descriptor ?? null;

        let matchedPeople = [];
        let peopleNames = [];
        try {
          if (descriptor) {
            matchedPeople = await matchFaceToPeople(descriptor, session.user.username);
            peopleNames = matchedPeople.map((p) => p.name);
          }
        } catch (err) {
          console.error("Face match error:", err.message);
          matchedPeople = [];
          peopleNames = [];
        }

        let caption = null;
        try {
          if (process.env.OPENAI_API_KEY) {
            caption = await captionImage(uploadBuffer);
          }
        } catch (err) {
          console.error("Caption error:", err.message);
        }

        const { description, needsRecaption } = buildDescription({
          caption,
          filename: file.name,
          exif,
          faceCount,
          emotion,
          peopleNames,
          placeName,
        });

        let embeddingValue = null;
        try {
          if (process.env.HUGGINGFACE_API_KEY) {
            const emb = await embedText(description);
            embeddingValue = toSqlVector(emb);
          }
        } catch (err) {
          console.error("Embedding error:", err.message);
        }

        let inserted;
        try {
          inserted = await pool.query(
            `INSERT INTO photos (
              user_id, filename, url, uploaded_by, storage_path,
              mime_type, file_size, width, height, format,
              date_taken, camera_make, camera_model, latitude, longitude,
              place_name,
              face_count, dominant_emotion, ai_description, embedding, needs_recaption
            ) VALUES (
              $1,$2,$3,$4,$5,
              $6,$7,$8,$9,$10,
              $11,$12,$13,$14,$15,
              $16,
              $17,$18,$19,$20::vector,$21
            ) RETURNING id`,
            [
              userId,
              filename,
              url,
              session.user.username,
              storagePath,
              "image/jpeg",
              safeFileSize(file),
              imageMeta.width || null,
              imageMeta.height || null,
              imageMeta.format || null,
              exif?.DateTimeOriginal || null,
              exif?.Make || null,
              exif?.Model || null,
              exif?.latitude || null,
              exif?.longitude || null,
              placeName || null,
              faceCount,
              emotion,
              description,
              embeddingValue,
              needsRecaption,
            ]
          );
        } catch (err) {
          console.error("Photo DB insert failed:", err);
          continue;
        }

        const photoId = inserted.rows[0]?.id || null;

        if (photoId) {
          for (const person of matchedPeople) {
            try {
              await pool.query(
                "INSERT INTO photo_people (photo_id, person_id, confidence) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
                [photoId, person.id, person.confidence]
              );
            } catch (err) {
              console.error("photo_people insert error:", err.message);
            }
          }

          if (placeName) {
            try {
              await addPhotoToLocationAlbum(photoId, placeName, session.user.username);
            } catch (err) {
              console.error("Location album error:", err.message);
            }
          }
        }

        uploadedPhotos.push({
          id: photoId,
          filename,
          url,
          caption,
          description,
          peopleFound: peopleNames,
          isVideo: false,
          metadata: {
            width: imageMeta.width || null,
            height: imageMeta.height || null,
            format: imageMeta.format || null,
            dateTaken: exif?.DateTimeOriginal || null,
            cameraMake: exif?.Make || null,
            cameraModel: exif?.Model || null,
            latitude: exif?.latitude || null,
            longitude: exif?.longitude || null,
            placeName: placeName || null,
            faceCount,
            emotion,
          },
        });
      } catch (fileErr) {
        console.error("File processing failed for", file?.name, ":", fileErr.message);
      }
    }

    return NextResponse.json({ photos: uploadedPhotos }, { status: 201 });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    );
  }
}