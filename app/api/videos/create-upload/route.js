import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabaseAdmin from "@/lib/supabaseAdmin";

function safeFileName(name) {
  return String(name || "video.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(req) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const fileName = safeFileName(body.fileName);
    const userKey =
      session.user.username ||
      session.user.email ||
      session.user.name ||
      "unknown-user";

    const storagePath = `${String(userKey).replace(/[^a-zA-Z0-9._-]/g, "_")}/${Date.now()}-${fileName}`;

    const { data, error } = await supabaseAdmin.storage
      .from("videos")
      .createSignedUploadUrl(storagePath);

    if (error || !data?.token) {
      return NextResponse.json(
        { error: error?.message || "Failed to create signed upload URL" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      path: storagePath,
      token: data.token,
    });
  } catch (err) {
    console.error("CREATE VIDEO UPLOAD ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}