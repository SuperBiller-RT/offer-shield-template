import type { SourceDefinition } from "./types";
import { scrape as rmContractors } from "./rm-contractors";
import { scrape as breheny } from "./breheny";
import { scrape as jackson } from "./jackson";
import { scrape as octavius } from "./octavius";
import { scrape as kier } from "./kier";
import { scrape as vanelle } from "./vanelle";
import { scrape as balfour } from "./balfour";

// Authoritative list of all sources. Order here drives the UI ordering too.
export const SOURCES: SourceDefinition[] = [
  {
    slug: "rm_contractors",
    display_name: "RM Contractors",
    employer: "RM Contractors",
    kind: "static",
    url: "https://rmcontractors.co.uk/careers",
    run: rmContractors,
  },
  {
    slug: "breheny",
    display_name: "Breheny Civil Engineering",
    employer: "Breheny",
    kind: "static",
    url: "https://breheny.co.uk/job-vacancies/",
    run: breheny,
  },
  {
    slug: "jackson_civils",
    display_name: "Jackson Civil Engineering",
    employer: "Jackson Civils",
    kind: "static",
    url: "https://www.jackson-civils.co.uk/vacancies/",
    run: jackson,
  },
  {
    slug: "octavius",
    display_name: "Octavius",
    employer: "Octavius",
    kind: "static",
    url: "https://jobs.octavius.co.uk/",
    run: octavius,
  },
  {
    slug: "kier",
    display_name: "Kier Group",
    employer: "Kier",
    kind: "static",
    url: "https://jobs.kier.co.uk/jobs/search",
    run: kier,
  },
  {
    slug: "vanelle",
    display_name: "Van Elle",
    employer: "Van Elle",
    kind: "browserless",
    url: "https://vanellejsp.postingpanda.uk/",
    run: vanelle,
  },
  {
    slug: "balfour",
    display_name: "Balfour Beatty",
    employer: "Balfour Beatty",
    kind: "browserless",
    url: "https://www.balfourbeatty.com/careers/job-search/",
    run: balfour,
  },
];

export const SOURCE_BY_SLUG: Record<string, SourceDefinition> = Object.fromEntries(
  SOURCES.map((s) => [s.slug, s]),
);
