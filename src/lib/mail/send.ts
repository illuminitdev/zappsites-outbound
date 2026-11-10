import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type { Mailbox } from "../types";

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: string[];
  unsubscribeUrl?: string;
  /** Calendar invite (.ics text). Gmail/Outlook show it as an "Add to calendar" invite. */
  icalEvent?: string;
  replyTo?: string;
}

export function newMessageId(mailbox: Mailbox): string {
  return `<${randomUUID()}@${mailbox.email.split("@")[1]}>`;
}

/** Send via the mailbox's own SMTP (Google Workspace / Microsoft 365 / any host). Returns the Message-ID used. */
export async function sendMail(mailbox: Mailbox, mail: OutboundMail): Promise<string> {
  const transport = nodemailer.createTransport({
    host: mailbox.smtp_host,
    port: mailbox.smtp_port,
    secure: mailbox.smtp_port === 465,
    auth: { user: mailbox.smtp_user, pass: mailbox.smtp_pass },
  });
  const messageId = newMessageId(mailbox);
  const headers: Record<string, string> = {};
  if (mail.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${mail.unsubscribeUrl}>, <mailto:${mailbox.email}?subject=unsubscribe>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  await transport.sendMail({
    from: { name: mailbox.from_name, address: mailbox.email },
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    messageId,
    inReplyTo: mail.inReplyTo ?? undefined,
    references: mail.references?.length ? mail.references : undefined,
    headers,
    replyTo: mail.replyTo,
    icalEvent: mail.icalEvent ? { method: "REQUEST", filename: "invite.ics", content: mail.icalEvent } : undefined,
  });
  return messageId;
}
