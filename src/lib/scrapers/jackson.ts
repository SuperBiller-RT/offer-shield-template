import * as cheerio from "cheerio";
import type { ScrapeJob, ScraperFn } from "./types";

const LISTING_URL = "https://www.jackson-civils.co.uk/vacancies/";

const ROLE_KEYWORDS = [
  "engineer", "surveyor", "manager", "officer", "agent", "operative", "operator",
  "foreman", "designer", "estimator", "director", "administrator", "buyer",
  "planner", "coordinator", "supervisor", "steelfixer", "electrician", "plumber",
  "assistant", "apprentice", "graduate", "labourer",
];

function looksLikeRoleTitle(s: string): boolean {
  const lower = s.toLowerCase();
  if (lower.length < 4 || lower.length > 80) return false;
  return ROLE_KEYWORDS.some((k) => lower.includes(k));
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

// Jackson Civils builds the page with Elementor (a WordPress page builder).
// Each role is a stack of headings inside an Elementor container — no
// individual detail URLs, the listing is single-page. We walk the DOM
// grouping headings into (title, location) pairs.
export const scrape: ScraperFn = async (ctx) => {
  const r = await fetch(LISTING_URL, {
    headers: { "User-Agent": "Mozilla/5.0 OfferShieldBot" },
  });
  if (!r.ok) throw new Error(`jackson ${r.status}`);
  const html = await r.text();
  const $ = cheerio.load(html);

  const out: ScrapeJob[] = [];
  const seen = new Set<string>();

  // Strategy: walk every <h2>/<h3>. When we see a heading that "looks like a
  // role title" (contains an industry keyword), the next sibling heading is
  // usually the location. Group adjacent pairs.
  const headings = $("h1, h2, h3").toArray();
  for (let i = 0; i < headings.length; i++) {
    const text = $(headings[i]).text().replace(/\s+/g, " ").trim();
    if (!looksLikeRoleTitle(text)) continue;
    // Skip purely-navigational captions like "View role".
    if (/^view\b/i.test(text)) continue;
    // Look at the next heading for a location.
    let location: string | null = null;
    for (let j = i + 1; j < Math.min(i + 4, headings.length); j++) {
      const next = $(headings[j]).text().replace(/\s+/g, " ").trim();
      if (!next) continue;
      // A location typically contains a UK place name, comma, or "/". Heuristic.
      if (!looksLikeRoleTitle(next) && /[a-zA-Z]/.test(next) && next.length < 80) {
        location = next;
        break;
      }
    }
    const id = slugify(text + "-" + (location ?? "open"));
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      external_id: id,
      title: text,
      location,
      apply_url: LISTING_URL,
    });
  }

  if (!out.length) ctx.warn("jackson: no headings matched role-keyword heuristic");
  return out;
};
