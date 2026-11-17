import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { GoogleTag } from "@/components/GoogleTag";
import { displayScore, groupChecks, HIGH_ISSUE_CEILING } from "@/lib/audit/analyze";
import { brand } from "@/lib/brand";
import { db } from "@/lib/db";
import { fixPlan } from "@/lib/offers";
import type { AeoAudit, Audit, AuditCheck, Lead } from "@/lib/types";
import { PrintButton } from "./PrintButton";
import s from "./p.module.css";

export const dynamic = "force-dynamic";

const BOT = /bot|crawler|spider|preview|scanner|safelinks|proofpoint|mimecast|barracuda|headless|curl|wget|python|go-http/i;
const ENGINE: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude", perplexity: "Perplexity", gemini: "Gemini" };
const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const IMPACT_ORDER = { high: 0, medium: 1, low: 2 } as const;
const IMPACT_LABEL = { high: "High impact", medium: "Medium impact", low: "Quick win" } as const;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await db().from("leads").select("company").eq("slug", slug).maybeSingle<{ company: string }>();
  return { title: data ? `${data.company}: website report by ${brand.name}` : brand.name, robots: { index: false, follow: false } };
}

const tone = (v: number) => (v >= 75 ? "good" : v >= 50 ? "warn" : "bad");
const COLOR = { good: "#11845b", warn: "#d98a00", bad: "#d6402f" } as const;

function Ring({ score }: { score: number }) {
  const r = 64;
  const c = 2 * Math.PI * r;
  const color = COLOR[tone(score)];
  return (
    <svg className={s.ring} viewBox="0 0 160 160" role="img" aria-label={`Score ${score} out of 100`}>
      <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="13" />
      <circle
        cx="80"
        cy="80"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="13"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform="rotate(-90 80 80)"
      />
      <text x="80" y="86" textAnchor="middle" fontSize="44" fontWeight="750" fill="#fff">
        {score}
      </text>
      <text x="80" y="110" textAnchor="middle" fontSize="13" fill="rgba(255,255,255,.6)">
        out of 100
      </text>
    </svg>
  );
}

function verdict(score: number) {
  if (score >= 75) return { head: "Solid foundations", sub: "A few quick wins would make it work even harder for you." };
  if (score >= 50) return { head: "Working, but leaking enquiries", sub: "People are finding you, but some are leaving before they get in touch." };
  return { head: "Likely costing you customers", sub: "The issues below are stopping people finding you or getting in touch." };
}

/** "No. On a phone people..." -> "On a phone people..." */
const plain = (d: string) => d.replace(/^(No|Yes)[.,]\s*/i, "");

function Mark({ pass }: { pass: boolean | null }) {
  if (pass === null) return <span className={`${s.mark} ${s.markNa}`}>–</span>;
  return <span className={`${s.mark} ${pass ? s.markOk : s.markNo}`}>{pass ? "✓" : "✕"}</span>;
}

function AeoSection({ aeo, company }: { aeo: AeoAudit; company: string }) {
  const engines = aeo.engines;
  const cell = (prompt: string, engine: string) => aeo.results.find((r) => r.prompt === prompt && r.engine === engine);
  const t = aeo.mentions === 0 ? "bad" : aeo.mentionRate >= 50 ? "good" : "warn";
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <span className={s.kicker}>AI search</span>
        <h2>When your customers ask AI</h2>
        <p>
          We asked {and(engines.map((e) => ENGINE[e]))} the questions a buyer would ask
          {aeo.services?.length ? <> about {and(aeo.services.slice(0, 3))}</> : null}, without mentioning {company}.
        </p>
      </div>

      <div className={`${s.banner} ${s[t]}`}>
        <b>
          {aeo.mentions}/{aeo.answered}
        </b>
        <span>
          {aeo.mentions === 0
            ? `None of the AI answers mentioned ${company}. Those customers are being sent to someone else.`
            : `AI answers mentioned ${company} ${aeo.mentions} time${aeo.mentions === 1 ? "" : "s"}. There's room to show up in more.`}
        </span>
      </div>

      <div className={s.tableWrap}>
        <table className={s.aeo}>
          <thead>
            <tr>
              <th>Question</th>
              {engines.map((e) => (
                <th key={e}>{ENGINE[e]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {aeo.prompts.map((p) => (
              <tr key={p}>
                <td className={s.q}>&ldquo;{p}&rdquo;</td>
                {engines.map((e) => {
                  const r = cell(p, e);
                  return (
                    <td key={e} className={s.c}>
                      <Mark pass={!r || r.error ? null : r.mentioned} />
                      {r?.mentioned && r.position ? <small className={s.pos}>#{r.position}</small> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {aeo.topCompetitors.length > 0 && (
        <div className={s.recommended}>
          <span className={s.label}>Recommended instead of you</span>
          <div className={s.chips}>
            {aeo.topCompetitors.map((c) => (
              <span key={c.name} className={s.chip}>
                {c.name} <em>×{c.count}</em>
              </span>
            ))}
          </div>
        </div>
      )}
      {aeo.topCitedDomains.length > 0 && (
        <p className={s.note}>
          Sources the AI relied on: {aeo.topCitedDomains.slice(0, 5).map((d) => d.name).join(", ")}. AI answers vary between runs and
          users. Checked {new Date(aeo.ranAt).toLocaleDateString("en-GB")}.
        </p>
      )}
    </section>
  );
}

function Checklist({ checks }: { checks: AuditCheck[] }) {
  const groups = groupChecks(checks);
  const counted = checks.filter((c) => !c.unverified);
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <span className={s.kicker}>Everything we checked</span>
        <h2>Full checklist</h2>
        <p>
          {counted.filter((c) => c.pass).length} of {counted.length} checks passed, across {groups.length} areas.
        </p>
      </div>
      <div className={s.groups}>
        {groups.map((g) => {
          // Failed first, then passed, then the ones we couldn't check.
          const rank = (c: AuditCheck) => (c.unverified ? 2 : c.pass ? 1 : 0);
          const list = [...g.checks].sort((a, b) => rank(a) - rank(b));
          return (
            <div key={g.category} className={s.group}>
              <div className={s.groupHead}>
                <h3>{g.label}</h3>
                <span className={`${s.tally} ${g.passed === g.total ? s.good : g.passed / Math.max(g.total, 1) < 0.5 ? s.bad : s.warn}`}>
                  {g.passed}/{g.total}
                </span>
              </div>
              <ul>
                {list.map((c) => (
                  <li key={c.id}>
                    <Mark pass={c.unverified ? null : c.pass} />
                    <div>
                      <b>{c.label}</b>
                      <small>{c.unverified ? `Couldn't check. ${plain(c.detail)}` : c.pass ? plain(c.detail) || "Looks good." : plain(c.detail)}</small>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Cta({ book, offer }: { book: string; offer: string | null }) {
  return (
    <section className={s.cta}>
      <div>
        <span className={s.kicker}>Next step</span>
        <h2>Want these fixed?</h2>
        <p>{offer ?? "We'll walk you through every fix in 15 minutes, and you can keep this report either way. No obligation."}</p>
      </div>
      <div className={s.ctaSide}>
        <a className={s.btn} href={book}>
          Book a free 15-minute call →
        </a>
        <small>
          Or call {brand.phone} · <a href={`mailto:${brand.email}`}>{brand.email}</a>
        </small>
      </div>
    </section>
  );
}

// Plain-English headline for a failed check (the checklist keeps the short labels).
const HEADLINE: Record<string, string> = {
  ai_mentions: "AI assistants mostly recommend other firms",
  mobile_speed: "Your site is slow on a phone",
  service_pages: "Most of your services don't have their own page",
  schema: "Google and AI can't tell where you work",
  local_headline: "Your homepage doesn't say where you are",
  https: "Browsers warn people your site isn't secure",
  mobile: "The site isn't built for phones",
  title: "Your Google listing has no proper title",
  meta_description: "Google writes your search snippet for you",
  h1: "The page doesn't say what you do up front",
  cta: "There's no obvious next step for visitors",
  click_to_call: "People on phones can't tap to call you",
  ai_crawlers: "Your site blocks AI assistants",
  nap: "Your contact details don't line up",
  service_areas: "Nothing says which areas you cover",
  freshness: "The site looks like it hasn't been touched in a while",
  response_time: "The server is slow to respond",
  reachable: "Your website isn't loading",
  indexable: "Google has been told not to list your site",
  canonical: "Your site credits a different address",
  redirects: "Your site lives at more than one address",
  broken_links: "Some of your menu links are dead",
  mixed_content: "Browsers block part of your page",
  content_depth: "Your homepage says very little",
  faq: "Nothing answers the questions customers ask",
  reviews: "Your reviews aren't on the site",
  accreditations: "Nothing shows you're accredited or insured",
  contact_form: "There's no way to send an enquiry",
  online_booking: "Nobody can book or get a quote online",
  email_auth: "Your emails are likely to land in spam",
  og_tags: "Shared links show a blank box",
};

const FIX: Record<string, string> = {
  ai_mentions: "get you listed and described consistently on the sites AI tools read, and add pages that answer the questions customers ask.",
  mobile_speed: "rebuild the page to load in under two seconds on a phone: smaller images, less script, proper hosting.",
  service_pages: "a short page for each service, written for the town you work in, linked from your homepage.",
  schema: "add the business details (address, phone, areas, hours) in the format Google and AI tools read.",
  local_headline: "put your town in the page title and main heading, so it's clear who you serve.",
  https: "switch on SSL so the padlock shows. Usually same day.",
  mobile: "a mobile-first layout, so the site works properly on a phone.",
  meta_description: "write the two lines people see under your name on Google.",
  click_to_call: "make your number a tap-to-call button at the top of every page.",
  cta: "one clear button at the top: call, book, or get a quote.",
  ai_crawlers: "change one setting so AI assistants are allowed to read your site.",
  nap: "make your name, address and phone match everywhere, starting with your site and Google listing.",
  service_areas: "a page listing the towns you cover.",
  freshness: "update the copyright year, recent work and reviews.",
  indexable: "remove the noindex setting so Google can list the site. Usually a one-minute fix.",
  canonical: "point the canonical tag at your own address.",
  redirects: "send www, non-www and http to one address.",
  broken_links: "fix or remove the dead links.",
  mixed_content: "update the files still loading over plain http.",
  content_depth: "write a proper homepage: what you do, where, for whom, and why you.",
  faq: "an FAQ page answering the questions customers actually ask, marked up so AI tools can read it.",
  reviews: "pull your Google reviews onto the homepage so they update themselves.",
  accreditations: "show the badges and insurance you already have, near the top.",
  contact_form: "a short enquiry form that emails you and sends an auto-reply.",
  online_booking: "online booking or a quote request with confirmations and reminders.",
  email_auth: "add SPF and DMARC records to your domain. Half an hour, one-off.",
  og_tags: "set a title and picture for link previews.",
};

function FixPlanSection({ a }: { a: Audit | null }) {
  if (process.env.SHOW_FIX_PLAN === "false") return null;
  const plan = fixPlan(a);
  if (!plan.steps.length) return null;
  const gbp = (n: number) => `£${n}`;
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <span className={s.kicker}>Pricing</span>
        <h2>What we&apos;d fix, and what it costs</h2>
      </div>
      <div className={s.plan}>
        {plan.steps.map((st) => (
          <div key={st.offer.id} className={s.planStep}>
            <div className={s.planHead}>
              <h3>{st.offer.name}</h3>
              <span className={s.price}>
                {gbp(st.offer.price)} <small>a month</small>
              </span>
            </div>
            <p>{st.offer.blurb}</p>
            {st.fixes.length > 0 && (
              <ul>
                {st.fixes.slice(0, 6).map((c) => (
                  <li key={c.id}>{c.label}</li>
                ))}
                {st.fixes.length > 6 && <li>and {st.fixes.length - 6} more from the checklist</li>}
              </ul>
            )}
            {plan.noWebsite && st.offer.id === "essential" && <ul><li>A website for customers and AI assistants to find</li></ul>}
            <div className={s.term}>{st.offer.term}</div>
          </div>
        ))}
        {plan.bundle && (
          <div className={s.total}>
            Together that&apos;s {gbp(plan.monthly)} a month. Or the <b>{plan.bundle.name}</b> at {gbp(plan.bundle.price)} a month, which adds online
            booking and tracking of every call, form and booking ({plan.bundle.term}).
          </div>
        )}
      </div>
      <p className={s.note}>Prices from {brand.url.replace(/^https?:\/\//, "")}/pricing. We&apos;ll confirm everything on the call before you commit to anything.</p>
    </section>
  );
}

export default async function AuditPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data: lead } = await db().from("leads").select("*").eq("slug", slug).maybeSingle<Lead>();
  if (!lead) notFound();
  const { data: campaign } = lead.campaign_id
    ? await db().from("campaigns").select("offer").eq("id", lead.campaign_id).maybeSingle<{ offer: string }>()
    : { data: null };

  const ua = (await headers()).get("user-agent") ?? "";
  if (!BOT.test(ua)) await db().from("events").insert({ lead_id: lead.id, type: "page_view", meta: { ua: ua.slice(0, 200) } });

  const a: Audit | null = lead.audit;
  const hi = lead.first_name ? `Hi ${lead.first_name}. ` : "";
  const date = new Date(a?.fetchedAt ?? lead.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  // Checks we couldn't verify (JS-built or bot-protected sites) are shown as "couldn't check" and left out of the counts.
  const fails = a?.checks.filter((c) => !c.pass && !c.unverified) ?? [];
  const passed = a?.checks.filter((c) => c.pass && !c.unverified).length ?? 0;
  const skipped = a?.checks.filter((c) => c.unverified).length ?? 0;
  const top = a?.topIssues?.length ? a.topIssues : [...fails].sort((x, y) => IMPACT_ORDER[x.impact] - IMPACT_ORDER[y.impact]).slice(0, 3);
  const book = `/api/public/go/${lead.slug}`;
  const ok = !!a?.url && a.reachable;
  const score = ok ? displayScore(a!) : 0;
  const v = ok ? verdict(score) : null;
  const mobile = a?.performance.mobileScore ?? null;
  const shot = a?.performance.screenshot;

  return (
    <div className={s.page}>
      <header className={s.top}>
        <div className={s.topInner}>
          <a href={brand.url} className={s.logo}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logoUrl} alt={brand.name} />
          </a>
          <a href={book} className={s.topBtn}>
            Book a call
          </a>
        </div>
      </header>

      <div className={s.hero}>
        <div className={s.heroInner}>
          <div className={s.heroText}>
            <div className={s.heroTop}>
              <p className={s.eyebrow}>Website report · {date}</p>
              <PrintButton className={s.pdf} />
            </div>
            <h1>{lead.company}</h1>
            {lead.domain && (
              <a className={s.domain} href={a?.url || `https://${lead.domain}`} target="_blank" rel="noreferrer nofollow">
                {lead.domain} ↗
              </a>
            )}
            <p className={s.lede}>
              {!a?.url
                ? `${hi}We couldn't find a website for ${lead.company}. When customers search for you, or ask ChatGPT for a recommendation, there's nothing for them to land on.`
                : a.content === "blocked" && a.performance.mobileScore === null
                  ? `${hi}${lead.domain} blocks automated checks like ours, so we couldn't read the site itself. That's not a fault, but some AI tools are blocked the same way.`
                  : !a.reachable
                  ? `${hi}We tried to check ${lead.domain}, but the site didn't load. Anyone clicking through from Google or a business card sees an error page.`
                  : `${hi}We checked ${lead.domain} the way your customers find you: on a phone, on Google, and by asking AI assistants like ChatGPT. Here's what we found.`}
            </p>
            {ok && skipped > 0 && (
              <p className={s.notice}>
                {a!.content === "blocked"
                  ? `Your site blocks automated checks, so we skipped ${skipped} checks rather than guess. They're marked "couldn't check" below.`
                  : `${a!.platform && a!.platform !== "JavaScript app" ? `Your site is built on ${a!.platform} and` : "Your site"} loads its content with JavaScript, so we skipped ${skipped} checks rather than guess. They're marked "couldn't check" below.`}
              </p>
            )}
          </div>
          {ok && (
            <div className={s.scoreCard}>
              <Ring score={score} />
              <div>
                <p className={`${s.verdict} ${s[tone(score)]}`}>{v!.head}</p>
                <p className={s.verdictSub}>{v!.sub}</p>
                {score === HIGH_ISSUE_CEILING && <p className={s.capNote}>Held at {score} until the high-impact issues below are fixed.</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      <main className={s.wrap}>
        {ok && (
          <div className={s.stats}>
            <div className={s.stat}>
              <span>Mobile speed</span>
              <b className={mobile != null ? s[tone(mobile)] : ""}>{mobile ?? "–"}</b>
              <small>out of 100 on Google PageSpeed</small>
            </div>
            <div className={s.stat}>
              <span>Issues found</span>
              <b className={fails.length ? s.bad : s.good}>{fails.length}</b>
              <small>{passed} checks passed</small>
            </div>
            {a!.aeo ? (
              <div className={s.stat}>
                <span>AI recommends you</span>
                <b className={a!.aeo.mentions ? s.warn : s.bad}>
                  {a!.aeo.mentions}/{a!.aeo.answered}
                </b>
                <small>answers mention you</small>
              </div>
            ) : (
              <div className={s.stat}>
                <span>Load time</span>
                <b className={a!.performance.lcpSeconds != null ? s[a!.performance.lcpSeconds <= 2.5 ? "good" : a!.performance.lcpSeconds <= 4 ? "warn" : "bad"] : ""}>
                  {a!.performance.lcpSeconds != null ? `${a!.performance.lcpSeconds.toFixed(1)}s` : "–"}
                </b>
                <small>until the page shows on a phone</small>
              </div>
            )}
          </div>
        )}

        {lead.audit_note && (
          <section className={s.letter}>
            <p>{lead.audit_note}</p>
            <span>
              {brand.person}, {brand.personRole} at {brand.name}
            </span>
          </section>
        )}

        {!a?.url ? null : !a.reachable ? (
          <section className={s.section}>
            <div className={`${s.fix} ${s.high}`}>
              <span className={s.fixNum}>!</span>
              <div>
                <h3>{a.checks[0].label}</h3>
                <p>{a.checks[0].detail}</p>
              </div>
            </div>
          </section>
        ) : (
          top.length > 0 && (
            <section className={s.section}>
              <div className={s.sectionHead}>
                <span className={s.kicker}>Start here</span>
                <h2>What&apos;s costing you the most</h2>
                <p>Fix these first. They have the biggest effect on whether people find you and get in touch.</p>
              </div>
              <div className={s.fixWrap}>
                <ol className={s.fixes}>
                  {top.map((c, i) => (
                    <li key={c.id} className={`${s.fix} ${s[c.impact] ?? ""}`}>
                      <span className={s.fixNum}>{i + 1}</span>
                      <div>
                        <div className={s.fixHead}>
                          <h3>{HEADLINE[c.id] ?? c.label}</h3>
                          <span className={s.badge}>{IMPACT_LABEL[c.impact]}</span>
                        </div>
                        <p>{plain(c.detail)}</p>
                        {FIX[c.id] && (
                          <p className={s.fixHow}>
                            <b>What we&apos;d do:</b> {FIX[c.id]}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
                {shot && (
                  <figure className={s.phone}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot} alt={`${lead.domain} on a phone`} />
                    <figcaption>Your homepage on a phone</figcaption>
                  </figure>
                )}
              </div>
            </section>
          )
        )}

        {a?.aeo && <AeoSection aeo={a.aeo} company={lead.company} />}

        {ok && top.length > 0 && (
          <>
            <FixPlanSection a={a} />
            <Cta book={book} offer={campaign?.offer ?? null} />
          </>
        )}

        {ok && <Checklist checks={a!.checks} />}

        {!(ok && top.length > 0) && (
          <>
            <FixPlanSection a={a} />
            <Cta book={book} offer={campaign?.offer ?? null} />
          </>
        )}

        <footer className={s.foot}>
          Automated check of publicly available pages on {date}. Speed data from Google PageSpeed Insights
          {a?.aeo ? `; AI answers from ${and(a.aeo.engines.map((e) => ENGINE[e]))}` : ""}. {brand.identityLine}.{" "}
          <a href={`/u/${lead.slug}`}>Don&apos;t contact me again</a>
        </footer>
      </main>
      {lead.source === "inbound" && <GoogleTag />}
    </div>
  );
}
