import { AUDIT_TOKEN, BOOKING_TOKEN } from "../claude";

export interface RenderInput {
  body: string;
  auditUrl: string;
  bookingUrl: string;
  signature: string;
  unsubscribeUrl: string;
  /** "ZappSites, 160 City Road, London EC1V 2NX" (PECR: say who you are). */
  identity: string;
}

/**
 * Plain-text email: body, a personal sign-off, and a short, human-sounding footer that still
 * identifies the sender and gives an easy opt-out (PECR / UK GDPR).
 */
export function renderEmail(r: RenderInput): string {
  const body = r.body
    .replaceAll(AUDIT_TOKEN, r.auditUrl)
    .replaceAll(BOOKING_TOKEN, r.bookingUrl)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [
    body,
    "",
    r.signature.trim(),
    "",
    `${r.identity}. If this isn't relevant, reply "no" and I won't email again, or unsubscribe: ${r.unsubscribeUrl}`,
  ].join("\n");
}

export function threadSubject(firstSubject: string, step: number): string {
  if (step === 0) return firstSubject;
  return /^re:/i.test(firstSubject) ? firstSubject : `Re: ${firstSubject}`;
}
