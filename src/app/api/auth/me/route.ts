import { NextResponse } from "next/server";
import { checkAuth, authErrorResponse, effectivePermissions } from "@/lib/cdp/auth";

export const runtime = "nodejs";

export async function GET() {
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  return NextResponse.json({
    ok: true,
    user: { ...c.user, effective_permissions: effectivePermissions(c.user) },
    access_starts_at: c.access_starts_at,
    access_expires_at: c.access_expires_at,
    entitlements: c.entitlements,
  });
}
