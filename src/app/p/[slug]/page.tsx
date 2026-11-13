import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { GoogleTag } from "@/components/GoogleTag";
import { displayScore, HIGH_ISSUE_CEILING } from "@/lib/audit/analyze";
import { brand } from "@/lib/brand";
import { db } from "@/lib/db";
import type { AeoAudit, Audit, AuditCheck, Lead } from "@/lib/types";
import s from "./p.module.css";

export const dynamic = "force-dynamic";

const BOT = /bot|crawler|spider|preview|scanner|safelinks|proofpoint|mimecast|barracuda|headless|curl|wget|python|go-http/i;
const ENGINE: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude", perplexity: "Perplexity", gemini: "Gemini" };
const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const IMPACT_ORDER = { high: 0, medium: 1, low: 2 } as const;
const IMPACT_LABEL = { high: "High impact", medium: "Medium impact", low: "Quick win" } as const;
/** Which part of the report each check belongs to. */
const GROUP: Record<string, "Speed and phones" | "Google" | "AI assistants" | "Getting enquiries"> = {
  mobile: "Speed and phones",
  response_time: "Speed and phones",
  https: "Google",
  title: "Google",
  meta_description: "Google",
  h1: "Google",
  sitemap: "Google",
  alt_text: "Google",
  schema: "AI assistants",
  ai_crawlers: "AI assistants",
  llms_txt: "AI assistants",
  ai_mentions: "AI assistants",
  mobile_speed: "Speed and phones",
  click_to_call: "Getting enquiries",
  cta: "Getting enquiries",
  freshness: "Getting enquiries",
};
const GROUPS = ["Speed and phones", "Google", "AI assistants", "Getting enquiries"] as const;

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
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <span className={s.kicker}>Everything we checked</span>
        <h2>Full checklist</h2>
        <p>
          {checks.filter((c) => c.pass).length} of {checks.length} checks passed.
        </p>
      </div>
      <div className={s.groups}>
        {GROUPS.map((g) => {
          const list = checks.filter((c) => (GROUP[c.id] ?? "Google") === g).sort((a, b) => Number(a.pass) - Number(b.pass));
          if (!list.length) return null;
          const ok = list.filter((c) => c.pass).length;
          return (
            <div key={g} className={s.group}>
              <div className={s.groupHead}>
                <h3>{g}</h3>
                <span className={`${s.tally} ${ok === list.length ? s.good : ok === 0 ? s.bad : s.warn}`}>
                  {ok}/{list.length}
                </span>
              </div>
              <ul>
                {list.map((c) => (
                  <li key={c.id}>
                    <Mark pass={c.pass} />
                    <div>
                      <b>{c.label}</b>
                      <small>{c.pass ? plain(c.detail) || "Looks good." : plain(c.detail)}</small>
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
  const fails = a?.checks.filter((c) => !c.pass) ?? [];
  const passed = (a?.checks.length ?? 0) - fails.length;
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
            <p className={s.eyebrow}>Website report · {date}</p>
            <h1>{lead.company}</h1>
            {lead.domain && (
              <a className={s.domain} href={a?.url || `https://${lead.domain}`} target="_blank" rel="noreferrer nofollow">
                {lead.domain} ↗
              </a>
            )}
            <p className={s.lede}>
              {!a?.url
                ? `${hi}We couldn't find a website for ${lead.company}. When customers search for you, or ask ChatGPT for a recommendation, there's nothing for them to land on.`
                : !a.reachable
                  ? `${hi}We tried to check ${lead.domain}, but the site didn't load. Anyone clicking through from Google or a business card sees an error page.`
                  : `${hi}We checked ${lead.domain} the way your customers find you: on a phone, on Google, and by asking AI assistants like ChatGPT. Here's what we found.`}
            </p>
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
                          <h3>{c.label}</h3>
                          <span className={s.badge}>{IMPACT_LABEL[c.impact]}</span>
                        </div>
                        <p>{plain(c.detail)}</p>
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

        {ok && top.length > 0 && <Cta book={book} offer={campaign?.offer ?? null} />}

        {ok && <Checklist checks={a!.checks} />}

        {!(ok && top.length > 0) && <Cta book={book} offer={campaign?.offer ?? null} />}

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
