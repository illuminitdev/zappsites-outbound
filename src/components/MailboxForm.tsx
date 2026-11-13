"use client";

import { useState, type ReactNode } from "react";
import { Server } from "lucide-react";
import { GoogleIcon, MicrosoftIcon } from "./ProviderIcons";
import { saveMailbox } from "@/app/actions";
import { SubmitButton } from "./SubmitButton";

export type MailboxDefaults = {
  id: string;
  email: string;
  from_name: string;
  smtp_user: string;
  smtp_host: string;
  smtp_port: number;
  imap_host: string;
  imap_port: number;
  daily_limit: number;
};

const PROVIDERS: { value: string; label: string; icon: ReactNode; help: string }[] = [
  { value: "google", label: "Google Workspace / Gmail", icon: <GoogleIcon />, help: "Use an app password: Google Account → Security → 2-Step Verification → App passwords." },
  { value: "microsoft", label: "Microsoft 365 / Outlook", icon: <MicrosoftIcon />, help: "SMTP AUTH must be enabled for this mailbox in the Microsoft 365 admin centre." },
  { value: "other", label: "Other (custom SMTP / IMAP)", icon: <Server size={20} aria-hidden="true" />, help: "Use the mailbox's normal login password and the server details from your email host." },
];

function providerOf(m?: MailboxDefaults) {
  if (!m) return "google";
  if (m.smtp_host === "smtp.gmail.com") return "google";
  if (m.smtp_host === "smtp.office365.com") return "microsoft";
  return "other";
}

/** Add or edit a mailbox. Server details are only asked for when the provider isn't Google or Microsoft. */
export function MailboxForm({ mailbox }: { mailbox?: MailboxDefaults }) {
  const [provider, setProvider] = useState<string>(providerOf(mailbox));
  const editing = !!mailbox;
  const help = PROVIDERS.find((p) => p.value === provider)?.help;

  return (
    <form action={saveMailbox} className="modal-form">
      {editing && <input type="hidden" name="id" value={mailbox.id} />}
      <input type="hidden" name="provider" value={provider} />

      <label>Email provider</label>
      <div className="provider-pick">
        {PROVIDERS.map((p) => (
          <button type="button" key={p.value} className={provider === p.value ? "on" : undefined} onClick={() => setProvider(p.value)}>
            <span className="provider-icon">{p.icon}</span>
            <span>{p.label}</span>
          </button>
        ))}
      </div>
      {help && <p className="muted small">{help}</p>}

      <div className="row">
        <div>
          <label>Email address</label>
          <input name="email" type="email" required defaultValue={mailbox?.email} placeholder="ram@getwebvault.co.uk" />
        </div>
        <div>
          <label>From name</label>
          <input name="from_name" required defaultValue={mailbox?.from_name} placeholder="Ram Karri" />
        </div>
      </div>
      <div className="row">
        <div>
          <label>{provider === "other" ? "Email password" : "App password"}</label>
          <input name="smtp_pass" type="password" required={!editing} autoComplete="new-password" placeholder={editing ? "Leave blank to keep current" : provider === "other" ? "The mailbox's login password" : "xxxx xxxx xxxx xxxx"} />
        </div>
        <div>
          <label>Daily cold-email limit</label>
          <input name="daily_limit" type="number" min={1} max={200} defaultValue={mailbox?.daily_limit ?? 30} />
        </div>
      </div>

      {provider === "other" && (
        <>
          <label>SMTP username (if different from email)</label>
          <input name="smtp_user" defaultValue={mailbox && mailbox.smtp_user !== mailbox.email ? mailbox.smtp_user : ""} />
          <div className="row">
            <div>
              <label>SMTP host / port (sending)</label>
              <div className="host-port">
                <input name="smtp_host" required defaultValue={mailbox?.smtp_host} placeholder="smtp.example.com" />
                <input name="smtp_port" type="number" defaultValue={mailbox?.smtp_port ?? 465} />
              </div>
            </div>
            <div>
              <label>IMAP host / port (replies)</label>
              <div className="host-port">
                <input name="imap_host" required defaultValue={mailbox?.imap_host} placeholder="imap.example.com" />
                <input name="imap_port" type="number" defaultValue={mailbox?.imap_port ?? 993} />
              </div>
            </div>
          </div>
        </>
      )}

      <p className="muted small form-note">We test the login before saving, so this can take a few seconds.</p>
      <SubmitButton pending="Testing connection...">{editing ? "Save changes" : "Connect mailbox"}</SubmitButton>
    </form>
  );
}
