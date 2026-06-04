import { makeEarcuScraper } from "./earcu";

// Octavius's storefront is jobs.octavius.co.uk but the actual Earcu search
// listings live one subdomain over at careers.octavius.co.uk/jobs. If
// /jobs/search returns no matches, the upstream may have changed the path —
// the adapter will surface that via ctx.warn rather than throwing.
export const scrape = makeEarcuScraper({
  searchUrl: "https://careers.octavius.co.uk/jobs",
});
