import * as cheerio from "cheerio";
import type { ScrapeJob, ScraperFn } from "./types";

const PAGE_URL = "https://vanellejsp.postingpanda.uk/";

// Postingpanda SPA — Angular renders job rows into a list after the bundle
// boots and pulls from postingpandaapi-live.azurewebsites.net. We render via
// browserless and then parse the populated DOM with cheerio.
export const scrape: ScraperFn = async (ctx) => {
  const html = await ctx.browserlessHtml({
    url: PAGE_URL,
    // The page populates a job grid. Wait for any anchor that points to a
    // job-detail page; if that selector never appears (e.g. zero jobs), fall
    // back to the timed wait below.
    waitForSelector: 'a[href*="/Job/"], .jobItem, .job-card, [ng-repeat*="job"]',
  });

  const $ = cheerio.load(html);
  const out: ScrapeJob[] = [];
  const seen = new Set<string>();

  // Strategy: postingpanda emits each job as an anchor to /Job/<id>. Grab
  // them, extract the inner title text + nearby location/department span.
  $('a[href*="/Job/"]').each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (!href) return;
    const m = href.match(/\/Job\/([A-Za-z0-9_-]+)/);
    if (!m) return;
    const ext = m[1];
    if (seen.has(ext)) return;
    seen.add(ext);

    const text = $(el).text().replace(/\s+/g, " ").trim();
    // First non-empty line of the anchor text is usually the title.
    const lines = text.split(/[•|·]|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    const title = lines[0] || text.slice(0, 80);
    const location = lines.slice(1).find((l) => l.length < 60) || null;

    const apply_url = href.startsWith("http") ? href : new URL(href, PAGE_URL).toString();
    out.push({ external_id: ext, title, location, apply_url });
  });

  if (!out.length) {
    // Fallback heuristic: any element with a job-ish class containing a
    // recognisable role keyword.
    $(".jobItem, .job-card, .jobs-list-item, li[ng-repeat*='job']").each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim().slice(0, 120);
      if (!t) return;
      const id = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ external_id: id, title: t, location: null, apply_url: PAGE_URL });
    });
  }

  if (!out.length) ctx.warn("vanelle: no /Job/<id> anchors after browserless render");
  return out;
};
