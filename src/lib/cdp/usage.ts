import { sql } from "./db";

// app_slug this app writes under in the shared cdp_usage_events ledger.
const APP_SLUG = "offer_shield";

export interface RecordUsageArgs {
  userId: string;
  service: "openrouter" | (string & {});
  costUsd?: number;
  units?: number;
  model?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Append one row to cdp_usage_events. Fire-and-forget: never throws, never
 * blocks the caller's response. No metered services this round — kept for
 * parity with the rest of the suite so future LLM features can plug straight in.
 */
export async function recordUsage(args: RecordUsageArgs): Promise<void> {
  const costUsd = typeof args.costUsd === "number" && Number.isFinite(args.costUsd) ? args.costUsd : 0;
  const units = typeof args.units === "number" && Number.isFinite(args.units) ? args.units : 0;
  if (costUsd <= 0 && units <= 0) return;
  const model = args.model ?? null;
  const metaJson = JSON.stringify(args.meta ?? {});
  try {
    await sql`
      INSERT INTO cdp_usage_events (user_id, app_slug, service, cost_usd, units, model, meta)
      VALUES (${args.userId}, ${APP_SLUG}, ${args.service}, ${costUsd}, ${units}, ${model}, ${metaJson}::jsonb)
    `;
  } catch (e) {
    console.warn("[recordUsage] insert failed", e instanceof Error ? e.message : e);
  }
}
