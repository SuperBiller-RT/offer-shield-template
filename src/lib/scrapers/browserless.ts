// Thin wrapper around the browserless.maxailab.net `/content` endpoint —
// returns the fully-rendered HTML of a URL after JS execution. Used by
// adapters whose target page is an SPA or runs an AJAX call to populate
// the listing client-side.

interface BrowserlessOpts {
  url: string;
  // CSS selector to wait for before returning HTML. browserless treats
  // either form interchangeably; we prefer the selector when the adapter
  // knows what to look for.
  waitForSelector?: string;
  // Fallback fixed delay when no selector is known. Default 3000 ms.
  waitMs?: number;
}

export async function fetchRenderedHtml(opts: BrowserlessOpts): Promise<string> {
  const base = process.env.BROWSERLESS_URL;
  const token = process.env.BROWSERLESS_TOKEN;
  if (!base || !token) {
    throw new Error("BROWSERLESS_URL or BROWSERLESS_TOKEN not configured");
  }
  // Build the request body for /content. The browserless docker container we
  // run is the legacy `browserless/chrome:latest` image — its /content
  // endpoint accepts {url, waitFor:<ms|selector>, gotoOptions:{...}}.
  const body: Record<string, unknown> = {
    url: opts.url,
    gotoOptions: { waitUntil: "networkidle2", timeout: 25_000 },
  };
  if (opts.waitForSelector) body.waitFor = opts.waitForSelector;
  else body.waitFor = Math.max(0, opts.waitMs ?? 3000);

  const u = new URL(base.replace(/\/$/, "") + "/content");
  u.searchParams.set("token", token);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 40_000);
  try {
    const r = await fetch(u.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`browserless ${r.status}: ${text.slice(0, 200)}`);
    }
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}
