import { NextResponse } from "next/server";
import { checkAuth, authErrorResponse } from "@/lib/cdp/auth";
import { appSql, migrate } from "@/lib/cdp/db";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CaseRow {
  id: string;
  user_id: string;
  name: string | null;
  stage: string | null;
  risk: string | null;
  recruiter: string | null;
  current_role: string | null;
  new_role: string | null;
  contract_status: string | null;
  banner: string | null;
  notes: string | null;
  signals: unknown;
  consideration: unknown;
  created_at: string;
  updated_at: string;
}

const CONSIDERATION_MAX_BYTES = 32 * 1024;

function clampStr(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, max);
}
function clampSignals(v: unknown): number[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return [];
  return v
    .map((n) => (typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : null))
    .filter((n): n is number => n !== null && n >= 0 && n < 100)
    .slice(0, 32);
}
// Same semantics as cases/route.ts: undefined = field omitted, return as-is.
// null or invalid input passes through as null (clears the column).
function clampConsideration(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) return null;
  let json: string;
  try {
    json = JSON.stringify(v);
  } catch {
    return null;
  }
  if (json.length > CONSIDERATION_MAX_BYTES) return null;
  return json;
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
    SELECT id, user_id, name, stage, risk, recruiter, current_role, new_role,
           contract_status, banner, notes, signals, consideration,
           created_at, updated_at
    FROM os_cases
    WHERE id = ${id} AND user_id = ${c.user.id}
    LIMIT 1
  `) as CaseRow[];
  if (!rows.length) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, case: rows[0] });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: "id must be uuid" }, { status: 400 });
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  await migrate();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  // Per-field partial update via COALESCE: `undefined` (field omitted by
  // caller) preserves the stored value; an explicit `null` or trimmed-empty
  // string clears it. Matches rspy's saveUserBranding semantics.
  const name = clampStr(body.name, 200);
  const stage = clampStr(body.stage, 60);
  const risk = clampStr(body.risk, 30);
  const recruiter = clampStr(body.recruiter, 200);
  const currentRole = clampStr(body.current_role, 300);
  const newRole = clampStr(body.new_role, 300);
  const contractStatus = clampStr(body.contract_status, 200);
  const banner = clampStr(body.banner, 2000);
  const notes = clampStr(body.notes, 4000);
  const signalsArr = clampSignals(body.signals);
  const signalsJson = signalsArr === undefined ? null : JSON.stringify(signalsArr);
  // For `consideration`, `undefined` skips the column (COALESCE keeps current).
  // An explicit `null` from the caller is treated the same — we deliberately
  // don't support clearing consideration to a SQL null because the column has
  // a non-null default of '{}'::jsonb. To "reset" the form, send `{}` as the
  // value, which serializes to '{}' and overwrites cleanly.
  const considerationVal = clampConsideration(body.consideration);
  const considerationJson = considerationVal === undefined || considerationVal === null ? null : considerationVal;

  const rows = (await appSql`
    UPDATE os_cases SET
      name            = COALESCE(${name            ?? null}, name),
      stage           = COALESCE(${stage           ?? null}, stage),
      risk            = COALESCE(${risk            ?? null}, risk),
      recruiter       = COALESCE(${recruiter       ?? null}, recruiter),
      current_role    = COALESCE(${currentRole     ?? null}, current_role),
      new_role        = COALESCE(${newRole         ?? null}, new_role),
      contract_status = COALESCE(${contractStatus  ?? null}, contract_status),
      banner          = COALESCE(${banner          ?? null}, banner),
      notes           = COALESCE(${notes           ?? null}, notes),
      signals         = COALESCE(${signalsJson}::jsonb, signals),
      consideration   = COALESCE(${considerationJson}::jsonb, consideration),
      updated_at      = NOW()
    WHERE id = ${id} AND user_id = ${c.user.id}
    RETURNING id, user_id, name, stage, risk, recruiter, current_role, new_role,
              contract_status, banner, notes, signals, consideration,
              created_at, updated_at
  `) as CaseRow[];
  if (!rows.length) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, case: rows[0] });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: "id must be uuid" }, { status: 400 });
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  await migrate();
  // Revoke any outstanding share links before dropping the case so they 404
  // immediately rather than dangling.
  await appSql`UPDATE os_share_links SET revoked_at = NOW() WHERE case_id = ${id} AND user_id = ${c.user.id} AND revoked_at IS NULL`;
  const rows = (await appSql`
    DELETE FROM os_cases WHERE id = ${id} AND user_id = ${c.user.id}
    RETURNING id
  `) as Array<{ id: string }>;
  if (!rows.length) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
