import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  return NextResponse.json({
    url_set: !!url,
    url_value: url?.slice(0, 30) + "...",
    key_set: !!key,
    key_starts_with: key?.slice(0, 20) + "...",
    key_length: key?.length,
  });
}