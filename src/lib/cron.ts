import { env } from "./env";

/** Vercel cron sends `Authorization: Bearer $CRON_SECRET` automatically when CRON_SECRET is set. */
export function cronAuthorized(req: Request): boolean {
  return req.headers.get("authorization") === `Bearer ${env.cronSecret}`;
}
