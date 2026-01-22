import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidWallet(value: unknown) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed);
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Supabase non configurato" },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  const walletAddress = body?.wallet_address;
  if (!isValidWallet(walletAddress)) {
    return NextResponse.json(
      { error: "wallet_address non valido" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const payload = {
    user_id: walletAddress.toLowerCase(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("user_auth")
    .upsert(payload, { onConflict: "user_id" })
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ user: data });
}

export function GET() {
  return NextResponse.json(
    { error: "Metodo non supportato" },
    { status: 405 }
  );
}
