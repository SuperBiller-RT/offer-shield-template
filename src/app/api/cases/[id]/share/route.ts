import { NextResponse } from "next/server";
import { checkAuth, authErrorResponse } from "@/lib/cdp/auth";
import { appSql, migrate } from "@/lib/cdp/db";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shareUrl(req: Request, token: string): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || "considerationforchange.com";
  return `${proto}://${host}/c/${token}`;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: "id must be uuid" }, { status: 400 });
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  await migrate();

  // Confirm the case exists and belongs to this user before minting a token.
  const own = (await appSql`
    SELECT id FROM os_cases WHERE id = ${id} AND user_id = ${c.user.id} LIMIT 1
  `) as Array<{ id: string }>;
  if (!own.length) return NextResponse.json({ ok: false, error: "case not found" }, { status: 404 });

  const rows = (await appSql`
    INSERT INTO os_share_links (case_id, user_id)
    VALUES (${id}, ${c.user.id})
    RETURNING token, created_at, expires_at
  `) as Array<{ token: string; created_at: string; expires_at: string | null }>;
  const row = rows[0];
  return NextResponse.json({
    ok: true,
    token: row.token,
    url: shareUrl(req, row.token),
    created_at: row.created_at,
    expires_at: row.expires_at,
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: "id must be uuid" }, { status: 400 });
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  await migrate();
  const rows = (await appSql`
    SELECT token, created_at, expires_at, revoked_at
    FROM os_share_links
    WHERE case_id = ${id} AND user_id = ${c.user.id}
    ORDER BY created_at DESC
    LIMIT 50
  `) as Array<{ token: string; created_at: string; expires_at: string | null; revoked_at: string | null }>;
  return NextResponse.json({ ok: true, links: rows });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: "id must be uuid" }, { status: 400 });
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  await migrate();
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token || !UUID_RE.test(token)) {
    return NextResponse.json({ ok: false, error: "token query param required" }, { status: 400 });
  }
  const rows = (await appSql`
    UPDATE os_share_links SET revoked_at = NOW()
    WHERE token = ${token} AND case_id = ${id} AND user_id = ${c.user.id} AND revoked_at IS NULL
    RETURNING token
  `) as Array<{ token: string }>;
  if (!rows.length) return NextResponse.json({ ok: false, error: "link not found or already revoked" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
