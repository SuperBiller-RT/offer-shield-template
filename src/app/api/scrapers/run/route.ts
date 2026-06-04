import { NextResponse } from "next/server";
import { checkAuth, authErrorResponse } from "@/lib/cdp/auth";
import { migrate } from "@/lib/cdp/db";
import { runForUser } from "@/lib/scrapers/runner";
import { SOURCE_BY_SLUG } from "@/lib/scrapers/registry";

export const runtime = "nodejs";
// Worst-case = 5 static sources in parallel (~3s) + 2 browserless serialized
// (~8s each) ≈ 20s. 60s leaves comfortable headroom for slow upstreams.
export const maxDuration = 60;

export async function POST(req: Request) {
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  await migrate();

  let body: { source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }
  const source = (body.source || "").trim();
  if (!source) {
    return NextResponse.json({ ok: false, error: "source required ('all' or a slug)" }, { status: 400 });
  }
  if (source !== "all" && !SOURCE_BY_SLUG[source]) {
    return NextResponse.json({ ok: false, error: `unknown source: ${source}` }, { status: 400 });
  }

  try {
    const runs = await runForUser(c.user.id, source);
    return NextResponse.json({ ok: true, runs });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "scrape failed" },
      { status: 500 },
    );
  }
}
