import * as cheerio from "cheerio";
import type { ScrapeJob, ScraperFn } from "./types";

const LISTING_URL = "https://breheny.co.uk/job-vacancies/";

// Breheny is a clean WordPress site — each open role has a real detail page
// linked from /job-vacancies/ as /vacancies/<slug>/. We use the link slug as
// the external_id so it stays stable across re-scrapes.
export const scrape: ScraperFn = async (ctx) => {
  const r = await fetch(LISTING_URL, {
    headers: { "User-Agent": "Mozilla/5.0 OfferShieldBot" },
  });
  if (!r.ok) throw new Error(`breheny ${r.status}`);
  const html = await r.text();
  const $ = cheerio.load(html);

  const seen = new Set<string>();
  const out: ScrapeJob[] = [];

  $('a[href*="/vacancies/"]').each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (!href) return;
    // Only individual vacancy pages, not the parent listing.
    const m = href.match(/\/vacancies\/([a-z0-9-]+)\/?$/i);
    if (!m) return;
    const slug = m[1];
    if (seen.has(slug)) return;
    seen.add(slug);

    // Title — prefer the anchor's visible text, fall back to its `title`
    // attribute, then to a humanised slug.
    let title = ($(el).text() || "").replace(/\s+/g, " ").trim();
    if (!title) title = ($(el).attr("title") || "").trim();
    if (!title) {
      title = slug.replace(/-/g, " ").replace(/\b([a-z])/g, (c) => c.toUpperCase());
    }
    // Location often lives in a sibling element. Best-effort.
    const location =
      $(el).closest("article,.vacancy,.job-listing,li,tr,div").find(".location,.job-location").first().text().trim() ||
      null;

    out.push({
      external_id: slug,
      title,
      location,
      apply_url: href.startsWith("http") ? href : `https://breheny.co.uk${href}`,
    });
  });

  if (!out.length) ctx.warn("breheny: no /vacancies/<slug>/ links found");
  return out;
};
