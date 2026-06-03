import { sql, migrate } from "./db";

export const DEFAULT_MODEL = "openai/gpt-4.1-mini";

export const DEFAULT_BANNER_HEIGHT = 96;
export const MIN_BANNER_HEIGHT = 40;
export const MAX_BANNER_HEIGHT = 300;

// Slug this app is registered as in the admin panel's cdp_tools registry.
// Used to key into cdp_users.openrouter_keys JSONB so admin-set keys are
// honored without forcing the user to re-enter them in Settings.
const TOOL_SLUG = "offer_shield";

export interface AiSettings {
  apiKey: string;
  model: string;
}

export interface Branding {
  banner: string;
  bannerHeight: number;
  companyName: string;
  footer: string;
  bannerScale: number | null;
  bannerOffsetX: number | null;
  bannerOffsetY: number | null;
  bannerFrameWidth: number | null;
}

function normalizeBannerHeight(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_BANNER_HEIGHT;
  const n = Math.round(v);
  if (n < MIN_BANNER_HEIGHT) return MIN_BANNER_HEIGHT;
  if (n > MAX_BANNER_HEIGHT) return MAX_BANNER_HEIGHT;
  return n;
}

export async function getUserAiSettings(userId: string): Promise<AiSettings> {
  await migrate();
  const rows = (await sql`
    SELECT openrouter_key, openrouter_keys, openrouter_model, openrouter_models
    FROM cdp_users WHERE id = ${userId}
  `) as Array<{
    openrouter_key: string | null;
    openrouter_keys: Record<string, unknown> | null;
    openrouter_model: string | null;
    openrouter_models: Record<string, unknown> | null;
  }>;
  if (!rows.length) return { apiKey: "", model: DEFAULT_MODEL };
  // Key resolution priority: per-tool slot → cross-tool `__shared` slot →
  // legacy `openrouter_key` column. The shared slot lets admin set a single
  // key once and have every entitled tool pick it up without per-tool entry.
  const keysObj = rows[0].openrouter_keys || {};
  const perToolKey = keysObj[TOOL_SLUG];
  const sharedKey = keysObj.__shared;
  const apiKey =
    (typeof perToolKey === "string" && perToolKey.length > 0 && perToolKey) ||
    (typeof sharedKey === "string" && sharedKey.length > 0 && sharedKey) ||
    (rows[0].openrouter_key || "");
  const modelsObj = rows[0].openrouter_models || {};
  const perToolModel = modelsObj[TOOL_SLUG];
  const sharedModel = modelsObj.__shared;
  const model =
    (typeof perToolModel === "string" && perToolModel.length > 0 && perToolModel) ||
    (typeof sharedModel === "string" && sharedModel.length > 0 && sharedModel) ||
    rows[0].openrouter_model ||
    DEFAULT_MODEL;
  return { apiKey, model };
}

export async function saveUserAiSettings(
  userId: string,
  { apiKey, model }: { apiKey: string | null; model: string | null }
): Promise<void> {
  await migrate();
  if (apiKey === null && model === null) return;
  if (apiKey !== null) {
    if (apiKey.length > 0) {
      await sql`
        UPDATE cdp_users
        SET openrouter_keys = jsonb_set(
          COALESCE(openrouter_keys, '{}'::jsonb),
          ${`{${TOOL_SLUG}}`},
          to_jsonb(${apiKey}::text),
          true
        )
        WHERE id = ${userId}
      `;
    } else {
      await sql`
        UPDATE cdp_users
        SET openrouter_keys = COALESCE(openrouter_keys, '{}'::jsonb) - ${TOOL_SLUG}::text
        WHERE id = ${userId}
      `;
    }
  }
  if (model !== null) {
    await sql`UPDATE cdp_users SET openrouter_model = ${model || null} WHERE id = ${userId}`;
  }
}

export async function getUserBranding(userId: string): Promise<Branding> {
  await migrate();
  const rows = (await sql`
    SELECT brand_banner, brand_banner_height, brand_company_name, brand_footer,
           brand_banner_scale, brand_banner_offset_x, brand_banner_offset_y,
           brand_banner_frame_width
    FROM cdp_users WHERE id = ${userId}
  `) as Array<{
    brand_banner: string | null;
    brand_banner_height: number | null;
    brand_company_name: string | null;
    brand_footer: string | null;
    brand_banner_scale: number | null;
    brand_banner_offset_x: number | null;
    brand_banner_offset_y: number | null;
    brand_banner_frame_width: number | null;
  }>;
  if (!rows.length) {
    return {
      banner: "", bannerHeight: DEFAULT_BANNER_HEIGHT, companyName: "", footer: "",
      bannerScale: null, bannerOffsetX: null, bannerOffsetY: null, bannerFrameWidth: null,
    };
  }
  const r = rows[0];
  return {
    banner: r.brand_banner || "",
    bannerHeight: normalizeBannerHeight(r.brand_banner_height),
    companyName: r.brand_company_name || "",
    footer: r.brand_footer || "",
    bannerScale: typeof r.brand_banner_scale === "number" ? r.brand_banner_scale : null,
    bannerOffsetX: typeof r.brand_banner_offset_x === "number" ? r.brand_banner_offset_x : null,
    bannerOffsetY: typeof r.brand_banner_offset_y === "number" ? r.brand_banner_offset_y : null,
    bannerFrameWidth: typeof r.brand_banner_frame_width === "number" ? r.brand_banner_frame_width : null,
  };
}

export async function saveUserBranding(
  userId: string,
  patch: Partial<Branding>
): Promise<void> {
  await migrate();
  const banner = patch.banner;
  const height = patch.bannerHeight !== undefined ? normalizeBannerHeight(patch.bannerHeight) : undefined;
  const companyName = patch.companyName;
  const footer = patch.footer;
  const sc = patch.bannerScale;
  const ox = patch.bannerOffsetX;
  const oy = patch.bannerOffsetY;
  const fw = patch.bannerFrameWidth;
  await sql`
    UPDATE cdp_users
    SET brand_banner             = COALESCE(${banner      ?? null}, brand_banner),
        brand_banner_height      = COALESCE(${height      ?? null}, brand_banner_height),
        brand_company_name       = COALESCE(${companyName ?? null}, brand_company_name),
        brand_footer             = COALESCE(${footer      ?? null}, brand_footer),
        brand_banner_scale       = COALESCE(${sc === undefined ? null : sc}, brand_banner_scale),
        brand_banner_offset_x    = COALESCE(${ox === undefined ? null : ox}, brand_banner_offset_x),
        brand_banner_offset_y    = COALESCE(${oy === undefined ? null : oy}, brand_banner_offset_y),
        brand_banner_frame_width = COALESCE(${fw === undefined ? null : fw}, brand_banner_frame_width)
    WHERE id = ${userId}
  `;
}
