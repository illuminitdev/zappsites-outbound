import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { Mailbox } from "../types";

export interface InboundMail {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string | null;
  subject: string | null;
  text: string;
  date: Date;
  isBounce: boolean;
  bouncedRecipient: string | null;
}

/** Strip quoted history so Claude sees only what they wrote. */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const l of lines) {
    if (/^On .+wrote:\s*$/i.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l) || /^From:\s.+/i.test(l)) break;
    if (l.trim().startsWith(">")) continue;
    out.push(l);
  }
  return out.join("\n").trim();
}

export function detectBounce(from: string | null, subject: string | null, text: string): { isBounce: boolean; recipient: string | null } {
  const isBounce =
    /mailer-daemon|postmaster/i.test(from ?? "") ||
    /undeliverable|delivery status notification|mail delivery (failed|subsystem)|returned mail|failure notice/i.test(subject ?? "");
  if (!isBounce) return { isBounce: false, recipient: null };
  const m =
    text.match(/final-recipient:\s*rfc822;\s*([^\s>]+)/i) ??
    text.match(/original-recipient:\s*rfc822;\s*([^\s>]+)/i) ??
    text.match(/<([^<>\s]+@[^<>\s]+)>[^\n]*\n?[^\n]*(?:does not exist|user unknown|address not found|recipient rejected)/i) ??
    text.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
  return { isBounce: true, recipient: m ? m[1].toLowerCase() : null };
}

/** Fetch messages in INBOX with UID greater than `sinceUid`. Caps at `max` per run. */
export async function fetchNewMail(mailbox: Mailbox, sinceUid: number, max = 50): Promise<InboundMail[]> {
  const client = new ImapFlow({
    host: mailbox.imap_host,
    port: mailbox.imap_port,
    secure: mailbox.imap_port === 993,
    auth: { user: mailbox.smtp_user, pass: mailbox.smtp_pass },
    logger: false,
  });
  await client.connect();
  const out: InboundMail[] = [];
  const lock = await client.getMailboxLock("INBOX");
  try {
    for await (const msg of client.fetch(`${sinceUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
      if (msg.uid <= sinceUid || !msg.source) continue; // IMAP returns the last message for "n:*" even if n > max uid
      const parsed = await simpleParser(msg.source);
      const from = parsed.from?.value?.[0]?.address?.toLowerCase() ?? null;
      const text = parsed.text ?? "";
      const refs = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [];
      const bounce = detectBounce(from, parsed.subject ?? null, text);
      out.push({
        uid: msg.uid,
        messageId: parsed.messageId ?? null,
        inReplyTo: parsed.inReplyTo ?? null,
        references: refs,
        from,
        subject: parsed.subject ?? null,
        text,
        date: parsed.date ?? new Date(),
        isBounce: bounce.isBounce,
        bouncedRecipient: bounce.recipient,
      });
      if (out.length >= max) break;
    }
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
  return out;
}
