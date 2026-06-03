import { NextResponse } from "next/server";
import { checkAuth, authErrorResponse, effectivePermissions } from "@/lib/cdp/auth";
import {
  getUserAiSettings,
  saveUserAiSettings,
  DEFAULT_MODEL,
} from "@/lib/cdp/settings";

export const runtime = "nodejs";

function publicShape(s: Awaited<ReturnType<typeof getUserAiSettings>>) {
  return {
    ok: true,
    hasKey: !!s.apiKey,
    keyHint: s.apiKey ? s.apiKey.slice(-4) : "",
    model: s.model || DEFAULT_MODEL,
  };
}

export async function GET() {
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  const s = await getUserAiSettings(c.user.id);
  return NextResponse.json(publicShape(s));
}

export async function POST(req: Request) {
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  const user = c.user;
  let body: { apiKey?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : null;
  const model = typeof body.model === "string" ? body.model.trim() : null;

  if (apiKey !== null && !effectivePermissions(user).canInsertKeys) {
    return NextResponse.json(
      { ok: false, error: "Key insertion disabled for this account." },
      { status: 403 },
    );
  }

  if (apiKey !== null && apiKey.length > 0 && apiKey.length < 8)
    return NextResponse.json({ ok: false, error: "API key looks too short" }, { status: 400 });
  if (apiKey !== null && apiKey.length > 500)
    return NextResponse.json({ ok: false, error: "API key too long" }, { status: 400 });
  if (model !== null && model.length > 200)
    return NextResponse.json({ ok: false, error: "Model id too long" }, { status: 400 });

  await saveUserAiSettings(user.id, { apiKey, model });
  const s = await getUserAiSettings(user.id);
  return NextResponse.json(publicShape(s));
}
