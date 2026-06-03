import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_NAME, revokeSession } from "@/lib/cdp/auth";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (raw) {
    try {
      await revokeSession(raw);
    } catch {
      // ignore — we'll clear the cookie anyway
    }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
