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

/** Log in to the SMTP server without sending anything. Throws a readable error if it fails. */
export async function verifySmtp(m: Pick<Mailbox, "smtp_host" | "smtp_port" | "smtp_user" | "smtp_pass">): Promise<void> {
  const transport = nodemailer.createTransport({
    host: m.smtp_host,
    port: m.smtp_port,
    secure: m.smtp_port === 465,
    auth: { user: m.smtp_user, pass: m.smtp_pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  try {
    await transport.verify();
  } catch (e) {
    const err = e as { code?: string; responseCode?: number; message: string };
    if (err.code === "EAUTH" || err.responseCode === 535 || err.responseCode === 534)
      throw new Error("Login failed. Check the username and app password (a normal password won't work if 2-step verification is on).");
    if (err.code === "EDNS" || err.code === "ENOTFOUND") throw new Error(`Can't find server ${m.smtp_host}. Check the SMTP host.`);
    if (err.code === "ETIMEDOUT" || err.code === "ECONNECTION" || err.code === "ESOCKET")
      throw new Error(`Couldn't connect to ${m.smtp_host}:${m.smtp_port}. Check the host and port.`);
    throw new Error(`SMTP check failed: ${err.message}`);
  } finally {
    transport.close();
  }
}
