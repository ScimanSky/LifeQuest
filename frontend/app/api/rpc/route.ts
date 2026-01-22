import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rpcUrl = process.env.POLYGON_RPC_URL;
  if (!rpcUrl) {
    return NextResponse.json(
      { error: "RPC non configurato" },
      { status: 500 }
    );
  }

  const payload = await request.json();
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json"
    }
  });
}

export function GET() {
  return NextResponse.json(
    { error: "Metodo non supportato" },
    { status: 405 }
  );
}
