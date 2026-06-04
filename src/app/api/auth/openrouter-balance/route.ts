import { NextResponse } from "next/server";
import { checkAuth, authErrorResponse, effectivePermissions } from "@/lib/cdp/auth";
import { getUserAiSettings } from "@/lib/cdp/settings";

export const runtime = "nodejs";

// Separate route from /api/auth/ai-settings so the Settings page can fetch it
// on-demand without slowing down every refreshAiStatus() call elsewhere.
export async function GET() {
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  // OpenRouter balance: admins see the shared pool, members see their own
  // key's balance. Trial users are on the admin-provisioned key so showing
  // them the funder's pool would leak operational data.
  if (!effectivePermissions(c.user).canSeeBalance) {
    return NextResponse.json({ ok: false, error: "Balance not visible for this account." }, { status: 403 });
  }
  const { apiKey } = await getUserAiSettings(c.user.id);
  if (!apiKey) return NextResponse.json({ ok: false, error: "No OpenRouter key on file" }, { status: 400 });

  try {
    const r = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://considerationforchange.com",
        "X-Title": "OfferShield",
      },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `OpenRouter ${r.status}: ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }
    const d = (await r.json()) as { data?: { total_credits?: number; total_usage?: number } };
    const totalCredits = d.data?.total_credits ?? 0;
    const totalUsage = d.data?.total_usage ?? 0;
    return NextResponse.json({
      ok: true,
      totalCredits,
      totalUsage,
      remaining: Math.max(0, totalCredits - totalUsage),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Network error" },
      { status: 502 }
    );
  }
}
