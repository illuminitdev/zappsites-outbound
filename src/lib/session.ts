// Admin session cookie: "<userId>.<expiresAt>.<signature>". Logins are checked against the
// admin_users table; the cookie is signed with a key derived from SUPABASE_SERVICE_ROLE_KEY
// (server-only), so no separate secret is needed. Uses Web Crypto so it works in the proxy
// and in server actions.

export const SESSION_COOKIE = "oe_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 14; // 14 days

async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function signingKey(): string | null {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return k ? `outbound-admin-session-v2:${k}` : null;
}

export async function sessionToken(userId: string): Promise<string> {
  const key = signingKey();
  if (!key) throw new Error("Missing required env var SUPABASE_SERVICE_ROLE_KEY");
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + SESSION_MAX_AGE}`;
  return `${payload}.${await hmac(key, payload)}`;
}

export async function isValidSession(cookie: string | undefined): Promise<boolean> {
  const key = signingKey();
  if (!cookie || !key) return false;
  const parts = cookie.split(".");
  if (parts.length !== 3) return false;
  const [userId, exp, sig] = parts;
  if (!userId || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(key, `${userId}.${exp}`));
}
