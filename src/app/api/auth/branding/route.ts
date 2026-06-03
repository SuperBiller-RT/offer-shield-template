import { NextResponse } from "next/server";
import { checkAuth, authErrorResponse } from "@/lib/cdp/auth";
import { getUserBranding, saveUserBranding, MIN_BANNER_HEIGHT, MAX_BANNER_HEIGHT } from "@/lib/cdp/settings";

export const runtime = "nodejs";

const MAX_BANNER_BYTES = 2_000_000;

export async function GET() {
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  const user = c.user;
  const b = await getUserBranding(user.id);
  return NextResponse.json({ ok: true, ...b });
}

export async function POST(req: Request) {
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  const user = c.user;
  let body: {
    banner?: string;
    bannerHeight?: number;
    companyName?: string;
    footer?: string;
    bannerScale?: number;
    bannerOffsetX?: number;
    bannerOffsetY?: number;
    bannerFrameWidth?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }
  if (typeof body.banner === "string" && body.banner.length > MAX_BANNER_BYTES)
    return NextResponse.json({ ok: false, error: "Banner too large (crop or resize before upload)" }, { status: 413 });
  if (typeof body.companyName === "string" && body.companyName.length > 120)
    return NextResponse.json({ ok: false, error: "Company name too long" }, { status: 400 });
  if (typeof body.footer === "string" && body.footer.length > 240)
    return NextResponse.json({ ok: false, error: "Footer too long" }, { status: 400 });
  if (
    typeof body.bannerHeight === "number" &&
    (!Number.isFinite(body.bannerHeight) ||
      body.bannerHeight < MIN_BANNER_HEIGHT ||
      body.bannerHeight > MAX_BANNER_HEIGHT)
  )
    return NextResponse.json(
      { ok: false, error: `bannerHeight must be between ${MIN_BANNER_HEIGHT} and ${MAX_BANNER_HEIGHT}` },
      { status: 400 }
    );

  const numOrU = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

  await saveUserBranding(user.id, {
    banner: typeof body.banner === "string" ? body.banner : undefined,
    bannerHeight: typeof body.bannerHeight === "number" ? body.bannerHeight : undefined,
    companyName: typeof body.companyName === "string" ? body.companyName : undefined,
    footer: typeof body.footer === "string" ? body.footer : undefined,
    bannerScale: numOrU(body.bannerScale),
    bannerOffsetX: numOrU(body.bannerOffsetX),
    bannerOffsetY: numOrU(body.bannerOffsetY),
    bannerFrameWidth: numOrU(body.bannerFrameWidth),
  });
  const b = await getUserBranding(user.id);
  return NextResponse.json({ ok: true, ...b });
}
