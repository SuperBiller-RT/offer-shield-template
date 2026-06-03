import { NextResponse } from "next/server";
import { migrate } from "@/lib/cdp/db";

export const runtime = "nodejs";

// Temporary debug route. Returns full migration error in the response body
// so we can see what's actually failing on cold start. Remove once the
// schema converges. Not auth-gated on purpose — it only divulges DDL
// syntax errors and column lists, not data.
export async function GET() {
  try {
    await migrate();
    return NextResponse.json({ ok: true, migrated: true });
  } catch (e) {
    const err = e as {
      message?: string;
      code?: string;
      severity?: string;
      position?: string;
      routine?: string;
      query?: string;
      stack?: string;
    };
    return NextResponse.json(
      {
        ok: false,
        message: err?.message ?? String(e),
        code: err?.code,
        severity: err?.severity,
        position: err?.position,
        routine: err?.routine,
        query: err?.query,
        stack: err?.stack,
      },
      { status: 500 },
    );
  }
}
