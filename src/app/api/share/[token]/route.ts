import { NextResponse } from "next/server";
import { appSql, sql, migrate } from "@/lib/cdp/db";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ShareRow {
  case_id: string;
  user_id: string;
  expires_at: string | null;
  revoked_at: string | null;
  case_name: string | null;
  case_stage: string | null;
  case_risk: string | null;
  case_recruiter: string | null;
  case_current_role: string | null;
  case_new_role: string | null;
  case_contract_status: string | null;
  case_notes: string | null;
  case_signals: unknown;
  case_consideration: unknown;
}

// Public, unauthenticated. Resolves an `os_share_links.token` to the case
// snapshot a candidate sees on `app/c/[token]/page.tsx`. Returns 404 on any
// failure mode so a probe can't distinguish unknown / revoked / expired.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  await migrate();

  const rows = (await appSql`
    SELECT s.case_id, s.user_id, s.expires_at, s.revoked_at,
           c.name AS case_name, c.stage AS case_stage, c.risk AS case_risk,
           c.recruiter AS case_recruiter, c.current_title AS case_current_role,
           c.new_role AS case_new_role, c.contract_status AS case_contract_status,
           c.notes AS case_notes, c.signals AS case_signals,
           c.consideration AS case_consideration
    FROM os_share_links s
    JOIN os_cases c ON c.id = s.case_id AND c.user_id = s.user_id
    WHERE s.token = ${token}
    LIMIT 1
  `) as ShareRow[];

  if (!rows.length) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const row = rows[0];
  if (row.revoked_at) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  // Pull the owner's branding so the candidate sees the recruiter's
  // agency name / banner rather than the SuperBiller default. Best-effort:
  // failure here still returns the case data, just without branding.
  let sender: {
    agency_name: string | null;
    recruiter_name: string | null;
    banner: string | null;
  } = { agency_name: null, recruiter_name: null, banner: null };
  try {
    const owner = (await sql`
      SELECT display_name, brand_company_name, brand_banner
      FROM cdp_users WHERE id = ${row.user_id} LIMIT 1
    `) as Array<{ display_name: string | null; brand_company_name: string | null; brand_banner: string | null }>;
    if (owner.length) {
      sender = {
        agency_name: owner[0].brand_company_name,
        recruiter_name: owner[0].display_name,
        banner: owner[0].brand_banner,
      };
    }
  } catch {
    // ignore — leave sender at defaults
  }

  return NextResponse.json({
    ok: true,
    case: {
      name: row.case_name,
      stage: row.case_stage,
      risk: row.case_risk,
      recruiter: row.case_recruiter,
      current_role: row.case_current_role,
      new_role: row.case_new_role,
      contract_status: row.case_contract_status,
      notes: row.case_notes,
      signals: row.case_signals,
      consideration: row.case_consideration,
    },
    sender,
  });
}
