import { NextResponse } from "next/server";
import { checkAuth, authErrorResponse } from "@/lib/cdp/auth";
import { appSql, migrate } from "@/lib/cdp/db";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Soft-delete a scraped job. Sets dismissed_at so re-scrapes don't
// re-surface the same row in the default-filtered list, while keeping the
// row around in case the recruiter wants an "include dismissed" view later.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: "id must be uuid" }, { status: 400 });
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  await migrate();
  const rows = (await appSql`
    UPDATE os_jobs SET dismissed_at = NOW()
    WHERE id = ${id} AND user_id = ${c.user.id} AND dismissed_at IS NULL
    RETURNING id
  `) as Array<{ id: string }>;
  if (!rows.length) return NextResponse.json({ ok: false, error: "not found or already dismissed" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
