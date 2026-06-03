import { NextResponse } from "next/server";
import { checkAuth, authErrorResponse } from "@/lib/cdp/auth";
import { appSql, migrate } from "@/lib/cdp/db";

export const runtime = "nodejs";

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

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, max);
}

function clampSignals(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((n) => (typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : null))
    .filter((n): n is number => n !== null && n >= 0 && n < 100)
    .slice(0, 32);
}

// `consideration` is an opaque JSONB blob holding the form state (value
// chips, comparison verdicts, financial table, candidate reasons). Schema
// owned by the client — server enforces only: must be a plain object, must
// serialize under the byte cap. Returns `null` on invalid input (caller
// translates to "field not present" semantics).
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

export async function GET() {
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  await migrate();
  const rows = (await appSql`
    SELECT id, user_id, name, stage, risk, recruiter, current_role, new_role,
           contract_status, banner, notes, signals, consideration,
           created_at, updated_at
    FROM os_cases
    WHERE user_id = ${c.user.id}
    ORDER BY updated_at DESC
    LIMIT 200
  `) as CaseRow[];
  return NextResponse.json({ ok: true, cases: rows });
}

export async function POST(req: Request) {
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  await migrate();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }
  const name = clampStr(body.name, 200);
  if (!name) {
    return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });
  }
  const signals = JSON.stringify(clampSignals(body.signals));
  const consideration = clampConsideration(body.consideration);
  // On invalid input we coerce to the default empty object rather than
  // rejecting — keeps the create path forgiving for partially-filled forms.
  const considerationJson = consideration === undefined || consideration === null ? "{}" : consideration;
  const rows = (await appSql`
    INSERT INTO os_cases (
      user_id, name, stage, risk, recruiter, current_role, new_role,
      contract_status, banner, notes, signals, consideration
    ) VALUES (
      ${c.user.id},
      ${name},
      ${clampStr(body.stage, 60)},
      ${clampStr(body.risk, 30)},
      ${clampStr(body.recruiter, 200)},
      ${clampStr(body.current_role, 300)},
      ${clampStr(body.new_role, 300)},
      ${clampStr(body.contract_status, 200)},
      ${clampStr(body.banner, 2000)},
      ${clampStr(body.notes, 4000)},
      ${signals}::jsonb,
      ${considerationJson}::jsonb
    )
    RETURNING id, user_id, name, stage, risk, recruiter, current_role, new_role,
              contract_status, banner, notes, signals, consideration,
              created_at, updated_at
  `) as CaseRow[];
  return NextResponse.json({ ok: true, case: rows[0] });
}
