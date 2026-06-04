import type { ScrapeJob, ScraperFn } from "./types";

// RM Contractors uses Gatsby + Prismic. The /careers page is built from a
// JSON sibling at /page-data/careers/page-data.json — fetching that gives
// us the structured Prismic slices without parsing HTML.
const PAGE_DATA_URL = "https://rmcontractors.co.uk/page-data/careers/page-data.json";

interface PrismicSliceField {
  text?: string;
}
interface PrismicSlice {
  slice_type?: string;
  primary?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
}
interface PageDataShape {
  result?: {
    data?: {
      prismicPage?: {
        data?: {
          body?: PrismicSlice[];
        };
      };
    };
  };
}

function asText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) {
    return v.map((x) => asText((x as PrismicSliceField).text ?? x)).join(" ").trim();
  }
  if (v && typeof v === "object" && "text" in (v as Record<string, unknown>)) {
    return asText((v as PrismicSliceField).text);
  }
  return "";
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export const scrape: ScraperFn = async (ctx) => {
  const r = await fetch(PAGE_DATA_URL, {
    headers: { "User-Agent": "Mozilla/5.0 OfferShieldBot" },
  });
  if (!r.ok) throw new Error(`page-data ${r.status}`);
  const data = (await r.json()) as PageDataShape;
  const slices = data.result?.data?.prismicPage?.data?.body ?? [];

  const out: ScrapeJob[] = [];
  for (const s of slices) {
    // Job-listing slices on this site use slice_type === "job_listing" /
    // "vacancy" — fall back to scanning any slice with a recognisably-titled
    // text field. Slug + title heuristics keep us robust to Prismic edits.
    const stype = (s.slice_type || "").toLowerCase();
    const isJobish = stype.includes("job") || stype.includes("vacanc") || stype.includes("role");
    const primary = s.primary || {};
    const title = asText(primary.title ?? primary.role_title ?? primary.job_title ?? primary.heading);
    const location = asText(primary.location ?? primary.where ?? primary.site);
    const description = asText(primary.description ?? primary.summary ?? primary.body);
    if (!isJobish && !title) continue;
    if (!title) {
      ctx.warn(`rm: empty title in slice_type=${stype}`);
      continue;
    }
    const id = slugify(title + "-" + (location || "open"));
    out.push({
      external_id: id,
      title,
      location: location || null,
      description: description || null,
      apply_url: "https://rmcontractors.co.uk/careers",
      raw: { slice_type: stype },
    });
  }
  return out;
};
