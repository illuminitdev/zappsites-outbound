const UA =
  "Mozilla/5.0 (compatible; SiteAuditBot/1.0; +https://example.invalid/bot) AppleWebKit/537.36 (KHTML, like Gecko)";

export interface FetchResult {
  ok: boolean;
  status: number;
  url: string; // final URL after redirects
  text: string;
  ms: number;
  bytes: number;
  headers: Headers;
}

/** fetch with a timeout and a size cap; never throws for HTTP errors, only returns ok=false. */
export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {},
): Promise<FetchResult> {
  const { timeoutMs = 15000, maxBytes = 3_000_000 } = opts;
  const started = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": UA, accept: "text/html,*/*;q=0.8", ...opts.headers },
    });
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
    return {
      ok: res.ok,
      status: res.status,
      url: res.url || url,
      text: new TextDecoder("utf-8", { fatal: false }).decode(slice),
      ms: Date.now() - started,
      bytes: buf.byteLength,
      headers: res.headers,
    };
  } catch {
    return { ok: false, status: 0, url, text: "", ms: Date.now() - started, bytes: 0, headers: new Headers() };
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 60000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/** "https://www.Acme.co.uk/path" -> "acme.co.uk" */
export function toDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    return new URL(s).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function toUrl(input: string | null | undefined): string | null {
  const d = toDomain(input);
  if (!d) return null;
  const raw = input!.trim();
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}
