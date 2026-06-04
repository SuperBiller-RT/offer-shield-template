import { makeEarcuScraper } from "./earcu";

export const scrape = makeEarcuScraper({
  searchUrl: "https://jobs.kier.co.uk/jobs/search",
});
