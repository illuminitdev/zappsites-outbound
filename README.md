# Outbound engine (ZappSites)

Everything prospects see is branded **ZappSites** (logo, contact details, "Ram, Founder"), set with the `BRAND_*` env vars. Emails and the audit page are written to read like a person wrote them:
- Claude follows a style guide with example emails.
- Stock phrases are blocked, with one automatic rewrite if any slip through.
- A deterministic clean-up strips dashes, curly quotes, exclamation marks and Title Case subjects.

A self-owned outbound system on your own stack (Next.js 16, TypeScript, Supabase, Claude). It finds UK businesses, audits each one's website, writes a personal email sequence with Claude, sends it from your own mailboxes, reads the replies, drafts your answers and tracks meetings.

Every prospect gets a personalised audit page with real findings, not an animation. The page is shown below:

```
https://outbound.yourdomain.co.uk/p/<slug>   ->  score, mobile speed, top 3 issues, full checklist, "Book a 15-minute call"
```

## How it works

```
Import leads ──► Enrich ──► Audit ──► Write (Claude) ──► Approve ──► Send ──► Poll replies ──► Triage (Claude) ──► You reply
 CSV / Maps /     email +    speed,     3-step sequence     you or      your      IMAP, every      interested / question /   drafts ready
 Companies House  PECR       SEO, AI    using real audit    auto        SMTP      10 min           unsubscribe / bounce...   in /inbox
```

The pipeline runs in bounded steps on a 10-minute cron (`/api/cron/tick`). Each stage moves a lead to the next status: `new → enriched → audited → ready → sequencing → replied / interested → meeting`.

| Stage | What happens |
| --- | --- |
| **Lead sources** | Google Maps search (Places API), new incorporations by SIC code (Companies House, free), or CSV upload. Duplicates by domain are skipped. |
| **Enrich** | Finds an email published on their site (homepage, /contact, /about), then falls back to Hunter if you've set a key. Checks MX records or uses Hunter's verifier. **It never guesses `firstname@` addresses**, because bounces burn your domain. It also matches the business on Companies House to set its PECR status. |
| **Audit** | Google PageSpeed (mobile), HTTPS, title, meta description, H1, viewport, business schema, robots.txt blocks on GPTBot/ClaudeBot/Perplexity/Google-Extended, llms.txt, sitemap, click-to-call, CTA, stale © year, alt text, response time. Gives a score from 0 to 100 and the top 3 issues. |
| **AEO/GEO mentions** | Reads the prospect's homepage and services page, picks out the services they actually sell (e.g. boiler repair, bathroom fitting), and writes one buyer question per service. Leave the campaign's AI questions empty for this, or use `{service}` in your own. It then asks ChatGPT (with web search), Claude (with web search), Perplexity and Gemini (with Google Search grounding) those questions, which never name the prospect, e.g. *"Who are the best commercial insurance brokers for tradespeople in Leeds?"*. Records whether each answer mentions or cites them and at what list position, which competitors are named instead, and which sources the engines relied on. Each engine is switched on by its API key, and it only runs when the campaign has an **AEO category** set. Cost: prompts × engines calls per lead (default 3 × up to 4). The result is a high-impact check in the score, its own section on the prospect page, and the opener Claude usually picks for the email. |
| **Write** | Claude writes the whole sequence in one call from your offer, your *proof* text and their audit. It's told never to invent facts. Emails are plain text, under 110 words, with `[AUDIT_LINK]` and `[BOOKING_LINK]` filled in at send time. |
| **Approve** | Approval is manual by default: review or edit the drafts on the lead page, then approve in bulk. You can switch on `auto_approve` per campaign once you trust the output. |
| **Send** | Sends in a weekday window (08:00 to 17:00 UK by default, DST-aware), with jitter. Each lead stays on the same mailbox, each mailbox has a daily cap, and there are at most 2 sends per mailbox per run. Follow-ups thread as `Re:` with In-Reply-To/References. Every email carries an RFC 8058 one-click `List-Unsubscribe` header and a footer with your company identity. |
| **Replies** | IMAP polls every mailbox and matches replies by thread headers or sender. It detects bounces and suppresses them. Any human reply stops the sequence. Claude classifies each reply and drafts an answer for `interested`, `question` and `not_now`. You edit it in `/inbox` and send it in-thread. |
| **Booking** | The "Book a 15-minute call" links go to a built-in booking page on your own domain (`/book/<slug>`, or `/book` for anyone, e.g. linked from zappsites.com). The defaults are any day, 08:00 to 20:00 UK time, 15-minute slots, 2 hours' notice and 14 days ahead; change them with the `BOOKING_*` env vars. Name, company and email are prefilled from the lead. The database stops two people booking the same slot. Booking a call stops that lead's sequence, marks it `meeting`, and emails a calendar invite to the prospect and to you. Upcoming calls show on the dashboard. Set `BOOKING_VIDEO_URL` to offer a video call as well as a phone call. |
| **Tracking** | Audit page views (link scanners and bots are filtered out), booking-link clicks via `/api/public/go/<slug>`, and meetings (one click on the lead page). |
| **Weekly report** | Mondays at 07:00 UTC, to `REPORT_TO`: sent, reply rate, interested, meetings, views, clicks and bounce rate. It warns you if bounces go over 3%. |

## Setup (about 30 minutes)

1. **Supabase.** Create a project, then run `supabase/migrations/0001_init.sql` `0002_aeo_mentions.sql`, `0003_page_note.sql`, `0004_bookings.sql` and `0005_admin_users.sql` in the SQL editor.
2. **Environment.** `cp .env.example .env.local` and fill it in. You need Supabase, Anthropic, `APP_URL` and `CRON_SECRET`. The lead-source and Hunter keys are optional.
3. **Run locally.** `npm install && npm run dev`, then open http://localhost:3000. The default login is `admin` / `zappsites@2026` (created by migration `0005_admin_users.sql`); change it or add more logins in the Supabase SQL editor with `select admin_set_password('your-username', 'your-password');`.
4. **Deploy.** Push to Vercel and set the same env vars there. `vercel.json` already sets up both crons, and Vercel sends the `CRON_SECRET` bearer automatically. The tick needs a plan that allows `maxDuration = 300` (Pro). On Hobby, run `npm run worker` on Railway/Fly/a VPS instead, or call `/api/cron/tick` from any external cron with the bearer header.
5. In the app:
   1. **Mailboxes:** add 1–3 warmed mailboxes on a **secondary domain**.
   2. **Campaigns:** add your offer, ICP, true proof lines, booking link and signature. Tick *Active*.
   3. **Leads:** run a Maps search or a Companies House pull, or upload a CSV.
   4. **Run pipeline now**, or wait for cron. Review the drafts on `/leads?status=ready`, then approve.

`npm test` runs the unit tests (audit rules, robots parsing, DST-safe scheduling, rendering, CSV/email parsing, bounce detection). `npm run tick` runs one pipeline pass from the CLI.

## Deliverability rules (ignore them and nothing else matters)

- Never send from your main domain. Buy 1–2 lookalike domains and set up SPF, DKIM and DMARC (`p=none` to start). Point the bare domain at your real site.
- Warm each new mailbox for 2–3 weeks before any cold sending. Then start at 10 a day and stay under 30–40 a day per mailbox.
- Plain text only, no images, and at most two links. The engine already does this.
- Pause the campaign if bounces go over 3% or spam complaints over 0.1%. Google and Yahoo bulk-sender rules apply above 5,000 a day; stay far below that.
- Expect realistic numbers: 2–5% reply rate on well-targeted lists. The audit page is what lifts it.

## UK compliance (PECR + UK GDPR)

This is not legal advice. Check the [ICO guidance on electronic marketing](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/).

- **Corporate subscribers only.** Under PECR you can send unsolicited B2B marketing email without consent to limited companies, LLPs and PLCs, but not to sole traders or ordinary partnerships. The engine blocks sending until `pecr_ok` is true:
  - Companies House imports set it automatically.
  - Maps and CSV leads are matched on Companies House during enrichment.
  - Anything else needs your manual confirmation on the lead page.
- **Identify yourself and make opting out easy.** Every email has your company name and address (`SENDER_COMPANY`, `SENDER_ADDRESS`), a working unsubscribe link and a one-click unsubscribe header. Opt-outs go on a permanent suppression list.
- **UK GDPR.** Named business contacts are personal data. Your lawful basis is legitimate interests, so write a short legitimate interests assessment (LIA) and say how you got their details in your privacy notice. Delete leads that don't engage (e.g. after 6 months).
- Unsubscribe pages need a click (POST), because corporate link scanners open every URL in an email and would otherwise unsubscribe people by accident.

## Project map

```
supabase/migrations/0001_init.sql   schema (mailboxes, campaigns, leads, messages, suppression, events)
src/lib/pipeline.ts                 every pipeline stage + tick()
src/lib/audit/                      site audit (analyze.ts is pure and tested)
src/lib/leads/                      Companies House, Google Places, CSV, email finding/verification
src/lib/claude.ts                   sequence writer + reply triage (structured tool output)
src/lib/sequence/                   send-window scheduling, email rendering
src/lib/mail/                       SMTP send (nodemailer), IMAP polling (imapflow)
src/app/(admin)/                    dashboard, leads, lead detail, inbox, campaigns, mailboxes
src/app/p/[slug]/                   public prospect audit page
src/app/u/[slug]/                   unsubscribe
src/app/api/cron/                   tick + weekly report
src/proxy.ts                        basic auth for everything except /p, /u, cron and public APIs
```

## Known limits / next steps

- **AI answers vary between runs, users and locations.** The mentions audit is a snapshot, and the page says so. API answers can differ from the consumer ChatGPT/Gemini apps. Competitor names are pulled from list-style answers, so prose-only answers may yield none. Your SEO Stack AI Visibility Suite could replace this module with tracked prompt pools.
- **Model names and the Claude web-search tool version are set by env** (`OPENAI_AEO_MODEL`, `GEMINI_MODEL`, `PERPLEXITY_MODEL`, `AEO_CLAUDE_SEARCH_TOOL`). Check them against each provider's current docs before going live.
- **The booking page can't see your other calendar commitments.** It only knows about calls booked through it. If you add Google Calendar access (free/busy lookup), it could hide times you're already busy. Calls are moved by replying to the confirmation email.
- **Plain-text passwords.** Mailbox app passwords are stored in plain text in a table only the service role can read. Move them to Supabase Vault before adding other users.
- **Companies House leads often have no website or email.** Brand-new companies often have neither, so those leads land in `error` with a note. They suit a "you need a website" campaign once you find a contact.
