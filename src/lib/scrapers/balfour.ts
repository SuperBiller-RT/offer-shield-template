import * as cheerio from "cheerio";
import type { ScrapeJob, ScraperFn } from "./types";

const PAGE_URL =
  "https://www.balfourbeatty.com/careers/job-search/?searchTerm=&locationTerm=&industryTerm=&filters=";

// Balfour's careers shell loads jobs via /umbraco/api/careersapi/search,
// which requires an anti-forgery token from the page session. Rather than
// reverse-engineer the token flow we render via browserless and let the
// page populate normally.
export const scrape: ScraperFn = async (ctx) => {
  const html = await ctx.browserlessHtml({
    url: PAGE_URL,
    // Result cards land in elements anchored at /careers/job-search/details/<id>/
    waitForSelector: 'a[href*="/careers/job-search/details/"], .job-card, .job-result',
  });

  const $ = cheerio.load(html);
  const out: ScrapeJob[] = [];
  const seen = new Set<string>();

  $('a[href*="/careers/job-search/details/"]').each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (!href) return;
    const m = href.match(/\/careers\/job-search\/details\/([A-Za-z0-9_-]+)/);
    if (!m) return;
    const ext = m[1];
    if (seen.has(ext)) return;
    seen.add(ext);

    // Title is usually the anchor text or a nested heading. Take the first
    // non-empty <span>/<h*> inside, fall back to the anchor's own text.
    let title =
      $(el).find("h1,h2,h3,h4,span.title,strong").first().text().replace(/\s+/g, " ").trim() ||
      $(el).text().replace(/\s+/g, " ").trim();
    title = title.slice(0, 140);
    if (!title) return;

    // Location: walk siblings or descendants tagged accordingly.
    const card = $(el).closest("article, .job-card, .job-result, li, div");
    const location =
      card.find(".location, .job-location, [data-location]").first().text().replace(/\s+/g, " ").trim() ||
      null;

    const apply_url = href.startsWith("http")
      ? href
      : new URL(href, "https://www.balfourbeatty.com").toString();

    out.push({ external_id: ext, title, location, apply_url });
  });

  if (!out.length) ctx.warn("balfour: no /careers/job-search/details/ anchors after browserless render");
  return out;
};
