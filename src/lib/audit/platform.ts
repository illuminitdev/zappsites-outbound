// Accuracy helpers: which platform the site is built on, whether the HTML we fetched is an empty
// JavaScript shell (so content checks would be wrong), whether a bot wall blocked us, and an
// optional headless render via Browserless for JS-built sites.

export type Platform =
  | "WordPress"
  | "Wix"
  | "Squarespace"
  | "Shopify"
  | "Webflow"
  | "GoDaddy"
  | "Duda"
  | "Weebly"
  | "Framer"
  | "Jimdo"
  | "Yell"
  | "JavaScript app"
  | null;

export function detectPlatform(html: string, headers?: Headers): Platform {
  const h = html.slice(0, 400_000);
  const gen = h.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? "";
  const server = `${headers?.get("x-powered-by") ?? ""} ${headers?.get("server") ?? ""} ${headers?.get("x-wix-request-id") ? "wix" : ""}`;
  const t = `${gen} ${server}`;
  if (/wix/i.test(t) || /static\.wixstatic\.com|wix-bolt|_wixCssImports/i.test(h)) return "Wix";
  if (/squarespace/i.test(t) || /static1\.squarespace\.com|Static\.SQUARESPACE_CONTEXT/i.test(h)) return "Squarespace";
  if (/shopify/i.test(t) || /cdn\.shopify\.com|Shopify\.theme/i.test(h)) return "Shopify";
  if (/webflow/i.test(t) || /data-wf-(page|site)/i.test(h)) return "Webflow";
  if (/wordpress/i.test(t) || /\/wp-content\/|\/wp-includes\//i.test(h)) return "WordPress";
  if (/godaddy|website builder/i.test(t) || /img1\.wsimg\.com|godaddy/i.test(h)) return "GoDaddy";
  if (/duda/i.test(t) || /irp\.cdn-website\.com|dmAlbum|duda_website/i.test(h)) return "Duda";
  if (/weebly/i.test(t) || /editmysite\.com|weebly/i.test(h)) return "Weebly";
  if (/framer/i.test(t) || /framerusercontent\.com|data-framer-/i.test(h)) return "Framer";
  if (/jimdo/i.test(t) || /jimdo/i.test(h)) return "Jimdo";
  if (/yell/i.test(gen) || /yellsites|yell-sites/i.test(h)) return "Yell";
  if (looksJsRendered(html)) return "JavaScript app";
  return null;
}

/** Visible words in the body (rough), ignoring scripts and styles. */
export function visibleText(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  return body
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** An empty app shell: almost no text, content is built by JavaScript after load. */
export function looksJsRendered(html: string): boolean {
  const words = visibleText(html).split(" ").filter((w) => w.length > 1).length;
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  const shell = /<div[^>]+id=["'](root|app|__next|__nuxt|svelte|q-app)["'][^>]*>\s*<\/div>/i.test(html);
  return words < 60 && (shell || scripts >= 3);
}

/** Cloudflare / bot-protection challenge instead of the real page. */
export function isBotWall(status: number, html: string, headers?: Headers): boolean {
  const server = headers?.get("server") ?? "";
  if ([403, 429, 503].includes(status) && /cloudflare|akamai|sucuri|imperva|ddos-guard/i.test(server)) return true;
  return /cf-chl-|challenge-platform|Just a moment\.\.\.|Attention Required! \| Cloudflare|Checking your browser|sgcaptcha|Access denied \| .* used Cloudflare/i.test(
    html.slice(0, 50_000),
  );
}

/**
 * Fully rendered HTML from a headless browser. Optional: set BROWSERLESS_TOKEN
 * (browserless.io; BROWSERLESS_URL picks the region). Returns null if not configured or it fails.
 */
export async function renderHtml(url: string): Promise<string | null> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) return null;
  const base = (process.env.BROWSERLESS_URL || "https://production-sfo.browserless.io").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/content?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, gotoOptions: { waitUntil: "networkidle2", timeout: 25000 } }),
      signal: AbortSignal.timeout(35000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html.length > 200 ? html : null;
  } catch {
    return null;
  }
}
