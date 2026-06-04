import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { VALUE_LABELS, COMPARISON_FACTORS, hydrateFinancial, currencySymbol, DEFAULT_CURRENCY } from "@/components/consideration-constants";

type Verdict = "left" | "right" | "both";

interface ShareResponse {
  ok: true;
  case: {
    name: string | null;
    stage: string | null;
    current_role: string | null;
    new_role: string | null;
    notes: string | null;
    consideration?: {
      values?: number[];
      comparison?: Record<string, Verdict>;
      // Accept both the new FinancialRow[] and the legacy keyed-object shape;
      // hydrateFinancial() normalises before render.
      financial?: unknown;
      candidate_reasons?: string;
      currency?: string;
    } | null;
  };
  sender: {
    agency_name: string | null;
    recruiter_name: string | null;
    banner: string | null;
  };
}

async function fetchShare(token: string): Promise<ShareResponse | null> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const base = `${proto}://${host}`;
  try {
    const r = await fetch(`${base}/api/share/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!r.ok) return null;
    const d = (await r.json()) as ShareResponse;
    return d.ok ? d : null;
  } catch {
    return null;
  }
}

function parseAmount(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function fmtCurrency(n: number, symbol: string): string {
  return n <= 0 ? "—" : symbol + Math.round(n).toLocaleString("en-GB");
}

function splitRole(s: string | null) {
  if (!s) return { title: "", company: "" };
  const at = s.indexOf("@");
  if (at < 0) return { title: s.trim(), company: "" };
  return { title: s.slice(0, at).trim(), company: s.slice(at + 1).trim() };
}

export const dynamic = "force-dynamic";

export default async function CandidateSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await fetchShare(token);
  if (!data) notFound();

  const { case: caseRow, sender } = data;
  const cons = caseRow.consideration ?? {};
  const values = Array.isArray(cons.values) ? cons.values : [];
  const comparison = (cons.comparison && typeof cons.comparison === "object") ? cons.comparison : {};
  const financial = hydrateFinancial(cons.financial);
  const reasons = typeof cons.candidate_reasons === "string" ? cons.candidate_reasons : "";
  const symbol = currencySymbol(cons.currency ?? DEFAULT_CURRENCY);

  const leftRole = splitRole(caseRow.new_role);
  const rightRole = splitRole(caseRow.current_role);
  const leftHeader = leftRole.company || leftRole.title || "New company";
  const rightHeader = rightRole.company || rightRole.title || "Current company";

  // Currency-only roll-up. Percent rows (Pension etc.) are shown but excluded
  // so a "6%" entry doesn't add £6 to the total package.
  let tl = 0, tr = 0;
  for (const row of financial) {
    if (row.unit !== "currency") continue;
    tl += parseAmount(row.l ?? "");
    tr += parseAmount(row.r ?? "");
  }

  let leftScore = 0, rightScore = 0;
  for (let i = 0; i < COMPARISON_FACTORS.length; i++) {
    const v = comparison[String(i)];
    if (v === "left") leftScore++;
    else if (v === "right") rightScore++;
    else if (v === "both") { leftScore++; rightScore++; }
  }

  const senderLabel = sender.agency_name || sender.recruiter_name || "Your recruiter";

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: "32px 16px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {/* Sender banner */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: 18, boxShadow: "var(--shadow-sm)" }}>
          {sender.banner ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sender.banner}
              alt={sender.agency_name || "banner"}
              style={{ width: "100%", maxHeight: 200, objectFit: "cover", display: "block" }}
            />
          ) : null}
          <div style={{ padding: "16px 22px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 4 }}>
              Prepared by
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>
              {senderLabel}
            </div>
            {sender.recruiter_name && sender.agency_name && (
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}>{sender.recruiter_name}</div>
            )}
          </div>
        </div>

        {/* Case header */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "22px 24px", marginBottom: 18, boxShadow: "var(--shadow-sm)" }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px", marginBottom: 4 }}>
            Consideration for Change: {caseRow.name || "you"}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>
            This summary captures what you said matters in your work, side-by-side how the new role compares to your current one, and the financial picture. Review it whenever you need to re-anchor your decision.
          </div>
          {(caseRow.new_role || caseRow.current_role) && (
            <div style={{ marginTop: 14, fontSize: 13, color: "var(--text-secondary)" }}>
              {caseRow.new_role && (<div><strong style={{ color: "var(--text-primary)" }}>Considering:</strong> {caseRow.new_role}</div>)}
              {caseRow.current_role && (<div style={{ marginTop: 4 }}><strong style={{ color: "var(--text-primary)" }}>Current:</strong> {caseRow.current_role}</div>)}
            </div>
          )}
        </div>

        {/* Values */}
        {values.length > 0 && (
          <Section title="What really matters to you">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {values.map((i) => {
                const lbl = VALUE_LABELS[i];
                if (!lbl) return null;
                return (
                  <span
                    key={i}
                    style={{
                      padding: "6px 12px",
                      background: "var(--accent-light)",
                      color: "var(--accent)",
                      border: "1px solid #bfdbfe",
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {lbl}
                  </span>
                );
              })}
            </div>
          </Section>
        )}

        {/* Reasons */}
        {reasons.trim() && (
          <Section title="Your reasons for making this move">
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {reasons.trim()}
            </div>
          </Section>
        )}

        {/* Role comparison */}
        {Object.keys(comparison).length > 0 && (
          <Section title="Role comparison">
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "var(--surface-alt)", borderBottom: "1px solid var(--border)" }}>
                <div style={{ padding: "9px 14px", fontSize: 11, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: ".4px" }}>{leftHeader}</div>
                <div style={{ padding: "9px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>{rightHeader}</div>
              </div>
              {COMPARISON_FACTORS.map((factor, i) => {
                const v = comparison[String(i)];
                if (!v) return null;
                const leftOn = v === "left" || v === "both";
                const rightOn = v === "right" || v === "both";
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid var(--border-light)", fontSize: 12.5 }}>
                    <div style={{ padding: "9px 14px", color: leftOn ? "var(--accent)" : "var(--text-muted)", fontWeight: leftOn ? 600 : 400 }}>
                      {leftOn ? "✓ " : ""}{factor}
                    </div>
                    <div style={{ padding: "9px 14px", color: rightOn ? "var(--green)" : "var(--text-muted)", fontWeight: rightOn ? 600 : 400, background: "var(--surface-alt)" }}>
                      {rightOn ? "✓ " : ""}{factor}
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "2px solid var(--border)" }}>
                <div style={{ padding: "10px 14px", background: "var(--accent-light)" }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "var(--accent)" }}>{leftScore}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>factors favour new role</div>
                </div>
                <div style={{ padding: "10px 14px", background: "var(--surface-alt)" }}>
                  <div style={{ fontSize: 20, fontWeight: 900 }}>{rightScore}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>factors favour current role</div>
                </div>
              </div>
            </div>
          </Section>
        )}

        {/* Financial */}
        {(tl > 0 || tr > 0) && (
          <Section title="Financial comparison">
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "var(--surface-alt)", borderBottom: "1px solid var(--border)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                <div style={{ padding: "9px 14px", color: "var(--text-muted)" }}>Item</div>
                <div style={{ padding: "9px 14px", color: "var(--accent)" }}>{leftHeader}</div>
                <div style={{ padding: "9px 14px", color: "var(--text-muted)" }}>{rightHeader}</div>
              </div>
              {financial.map((row) => {
                if (!row.l && !row.r) return null;
                const isPercent = row.unit === "percent";
                const fmt = (raw: string) => {
                  if (!raw) return "—";
                  const n = parseAmount(raw);
                  if (n <= 0) return raw;
                  return isPercent ? `${n}%` : fmtCurrency(n, symbol);
                };
                return (
                  <div key={row.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid var(--border-light)", fontSize: 12.5 }}>
                    <div style={{ padding: "9px 14px", color: "var(--text-secondary)" }}>{row.label}</div>
                    <div style={{ padding: "9px 14px" }}>{fmt(row.l)}</div>
                    <div style={{ padding: "9px 14px" }}>{fmt(row.r)}</div>
                  </div>
                );
              })}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "var(--surface-alt)", borderTop: "2px solid var(--border)", fontSize: 13 }}>
                <div style={{ padding: "10px 14px", fontWeight: 700, color: "var(--text-secondary)" }}>Total Package (est.)</div>
                <div style={{ padding: "10px 14px", fontWeight: 800, color: tl > tr && tl > 0 ? "var(--green)" : "var(--text-primary)" }}>{fmtCurrency(tl, symbol)}</div>
                <div style={{ padding: "10px 14px", fontWeight: 800, color: tr > tl && tr > 0 ? "var(--green)" : "var(--text-primary)" }}>{fmtCurrency(tr, symbol)}</div>
              </div>
            </div>
          </Section>
        )}

        {/* Recruiter notes */}
        {caseRow.notes?.trim() && (
          <Section title="Recruiter notes">
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {caseRow.notes.trim()}
            </div>
          </Section>
        )}

        <div style={{ marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
          This summary was prepared for you by {senderLabel} using OfferShield.
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "18px 22px", marginBottom: 14, boxShadow: "var(--shadow-sm)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </div>
  );
}
