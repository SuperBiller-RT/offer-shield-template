import * as cheerio from "cheerio";
import type { ScrapeJob, ScraperFn } from "./types";

// Earcu is the ATS shared between Kier (jobs.kier.co.uk) and Octavius
// (jobs.octavius.co.uk / careers.octavius.co.uk). Both render their job
// search results server-side as `<article class="job-search-results-card-col">`
// blocks with an inner `<a id="link_job_title_…">` containing the title +
// location inline. Same selector pattern => one adapter, parameterised by URL.

interface EarcuOpts {
  searchUrl: string;     // /jobs/search page on the ATS subdomain
  applyBase?: string;    // optional override for relative apply links
}

function pickText($node: cheerio.Cheerio<unknown>): string {
  return $node.text().replace(/\s+/g, " ").trim();
}

export function makeEarcuScraper(opts: EarcuOpts): ScraperFn {
  return async (ctx) => {
    const r = await fetch(opts.searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 OfferShieldBot" },
    });
    if (!r.ok) throw new Error(`earcu ${r.status}`);
    const html = await r.text();
    const $ = cheerio.load(html);

    const out: ScrapeJob[] = [];
    const seen = new Set<string>();

    $("article.job-search-results-card-col, article.job-search-results-card").each((_, el) => {
      // Title + apply link
      const a = $(el).find('a[id^="link_job_title"]').first();
      const titleAnchor = a.length ? a : $(el).find("a").first();
      const title = pickText(titleAnchor).split("\n")[0].trim();
      if (!title) return;
      const href = (titleAnchor.attr("href") || "").trim();
      const apply_url = href
        ? href.startsWith("http")
          ? href
          : new URL(href, opts.searchUrl).toString()
        : opts.searchUrl;

      // External ID: prefer the URL slug (Earcu uses /jobs/<numeric-id>/...);
      // fallback to a hash of title.
      let ext: string | null = null;
      const m = apply_url.match(/\/(jobs?|vacancies?)\/(\d+)(?:\/|$)/i);
      if (m) ext = m[2];
      if (!ext) {
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
        ext = slug || `job-${out.length}`;
      }
      if (seen.has(ext)) return;
      seen.add(ext);

      // Location — Earcu cards put the location inside .job-component or
      // .job-location spans. Best-effort.
      const location =
        pickText($(el).find(".job-location, .job-component-location, li.job-location-li").first()) ||
        // Fallback: anything immediately after the anchor.
        pickText($(el).find("li").filter((_i, li) => /location|based/i.test($(li).text())).first()) ||
        null;

      out.push({
        external_id: ext,
        title,
        location,
        apply_url,
      });
    });

    if (!out.length) ctx.warn(`earcu(${opts.searchUrl}): no job-search-results-card articles found`);
    return out;
  };
}
