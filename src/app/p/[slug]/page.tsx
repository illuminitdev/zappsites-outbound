import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { GoogleTag } from "@/components/GoogleTag";
import { brand } from "@/lib/brand";
import { db } from "@/lib/db";
import type { AeoAudit, Audit, Lead } from "@/lib/types";
import s from "./p.module.css";

export const dynamic = "force-dynamic";

const BOT = /bot|crawler|spider|preview|scanner|safelinks|proofpoint|mimecast|barracuda|headless|curl|wget|python|go-http/i;
const ENGINE: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude", perplexity: "Perplexity", gemini: "Gemini" };
const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await db().from("leads").select("company").eq("slug", slug).maybeSingle<{ company: string }>();
  return { title: data ? `${data.company}: website check by ${brand.name}` : brand.name, robots: { index: false, follow: false } };
}

function Ring({ score }: { score: number }) {
  const r = 58;
  const c = 2 * Math.PI * r;
  const color = score >= 75 ? "#11845b" : score >= 50 ? "#c98a12" : "#c3332b";
  return (
    <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label={`Score ${score} out of 100`}>
      <circle cx="75" cy="75" r={r} fill="none" stroke="#ece9e3" strokeWidth="12" />
      <circle cx="75" cy="75" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 75 75)" />
      <text x="75" y="83" textAnchor="middle" fontSize="34" fontWeight="700" fill="#1b1d22">{score}</text>
    </svg>
  );
}

function verdict(score: number) {
  if (score >= 75) return "Solid foundations, a few quick wins left";
  if (score >= 50) return "Working, but leaking enquiries";
  return "This site is likely costing you customers";
}

function AeoSection({ aeo, company }: { aeo: AeoAudit; company: string }) {
  const engines = aeo.engines;
  const cell = (prompt: string, engine: string) => aeo.results.find((r) => r.prompt === prompt && r.engine === engine);
  return (
    <>
      <h2 className={s.h2}>When your customers ask AI</h2>
      <p className={s.sub}>
        We asked {and(engines.map((e) => ENGINE[e]))} the questions a buyer would ask
        {aeo.services?.length ? <> about the services on your website ({and(aeo.services.slice(0, 3))})</> : null}, without mentioning {company}.{" "}
        {aeo.mentions === 0 ? (
          <b>None of the {aeo.answered} answers mentioned you.</b>
        ) : (
          <b>
            You came up in {aeo.mentions} of {aeo.answered} answers.
          </b>
        )}
      </p>
      <div className={s.aeoTable} style={{ gridTemplateColumns: `minmax(180px, 2fr) repeat(${engines.length}, minmax(70px, 1fr))` }}>
        <div className={s.aeoHead}>Question</div>
        {engines.map((e) => (
          <div key={e} className={`${s.aeoHead} ${s.center}`}>
            {ENGINE[e]}
          </div>
        ))}
        {aeo.prompts.map((p) => (
          <div key={p} className={s.aeoRow}>
            <div className={s.aeoQ}>&ldquo;{p}&rdquo;</div>
            {engines.map((e) => {
              const r = cell(p, e);
              return (
                <div key={e} className={s.center}>
                  {!r || r.error ? <span className={s.na}>–</span> : r.mentioned ? <span className={s.ok}>✓{r.position ? ` #${r.position}` : ""}</span> : <span className={s.no}>✗</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {aeo.topCompetitors.length > 0 && (
        <>
          <p className={s.sub} style={{ marginTop: 18 }}>Recommended instead:</p>
          <div className={s.chips}>
            {aeo.topCompetitors.map((c) => (
              <span key={c.name} className={s.chip}>
                {c.name} <em>×{c.count}</em>
              </span>
            ))}
          </div>
        </>
      )}
      {aeo.topCitedDomains.length > 0 && (
        <p className={s.sub} style={{ marginTop: 14 }}>
          Sources the AI relied on: {aeo.topCitedDomains.slice(0, 5).map((d) => d.name).join(", ")}.
        </p>
      )}
      <p className={s.note}>AI answers change between runs and users. Checked {new Date(aeo.ranAt).toLocaleDateString("en-GB")}.</p>
    </>
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
  const name = lead.first_name ? `${lead.first_name}, here` : "Here";
  const date = new Date(a?.fetchedAt ?? lead.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const fails = a?.checks.filter((c) => !c.pass) ?? [];
  const aiChecks = a?.checks.filter((c) => ["schema", "ai_crawlers", "llms_txt"].includes(c.id)) ?? [];
  const aiPassed = aiChecks.filter((c) => c.pass).length;
  const book = `/api/public/go/${lead.slug}`;

  return (
    <div className={s.page}>
      <div className={s.wrap}>
        <div className={s.brand}>
          <a href={brand.url}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logoUrl} alt={brand.name} />
          </a>
          <span>{brand.tagline}</span>
        </div>
        <p className={s.eyebrow}>Website check · {date}</p>
        <h1 className={s.title}>{lead.company}</h1>

        {!a || !a.url ? (
          <>
            <p className={s.lede}>
              {name}&apos;s what we found: no website we could check for {lead.company}. When customers search for you, or ask
              ChatGPT for a recommendation, there&apos;s nothing for them to land on.
            </p>
            {a?.aeo && <AeoSection aeo={a.aeo} company={lead.company} />}
          </>
        ) : !a.reachable ? (
          <>
            <p className={s.lede}>{name}&apos;s what we found when we checked {lead.domain}: the site didn&apos;t load.</p>
            <div className={s.issue}>
              <h3>{a.checks[0].label}</h3>
              <p>{a.checks[0].detail} Anyone who clicks through from Google or a business card sees an error page.</p>
            </div>
            {a.aeo && <AeoSection aeo={a.aeo} company={lead.company} />}
          </>
        ) : (
          <>
            <p className={s.lede}>
              {name}&apos;s what we found when we checked {lead.domain} for speed, Google visibility and how AI assistants like
              ChatGPT see it.
            </p>
            <div className={s.hero}>
              <div>
                <Ring score={a.score} />
                <div className={s.ringLabel}>out of 100</div>
              </div>
              <div>
                <p className={s.verdict}>{verdict(a.score)}</p>
                <div className={s.metrics}>
                  <div className={s.metric}>
                    <b>{a.performance.mobileScore ?? "–"}</b>
                    <span>mobile speed /100</span>
                  </div>
                  <div className={s.metric}>
                    <b>{fails.length}</b>
                    <span>issues found</span>
                  </div>
                  {a.aeo ? (
                    <div className={s.metric}>
                      <b>
                        {a.aeo.mentions}/{a.aeo.answered}
                      </b>
                      <span>AI answers mention you</span>
                    </div>
                  ) : (
                    <div className={s.metric}>
                      <b>
                        {aiPassed}/{aiChecks.length}
                      </b>
                      <span>AI-readiness checks</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {a.aeo && <AeoSection aeo={a.aeo} company={lead.company} />}

            {a.topIssues.length > 0 && (
              <>
                <h2 className={s.h2}>What&apos;s costing you the most</h2>
                {a.topIssues.map((c) => (
                  <div key={c.id} className={`${s.issue} ${s[c.impact] ?? ""}`}>
                    <h3>{c.label}</h3>
                    <p>{c.detail}</p>
                  </div>
                ))}
              </>
            )}

            <h2 className={s.h2}>Full checklist</h2>
            <div className={s.list}>
              {a.checks.map((c) => (
                <div key={c.id} className={s.item}>
                  <span className={c.pass ? s.ok : s.no}>{c.pass ? "✓" : "✗"}</span>
                  <div>
                    {c.label}
                    <small>{c.detail}</small>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className={s.cta}>
          <h2>Want this fixed?</h2>
          <p>{campaign?.offer ?? "We'll walk you through the fixes in 15 minutes. No obligation."}</p>
          <a className={s.btn} href={book}>
            Book a 15-minute call →
          </a>
          <small>
            Or call {brand.phone} · <a href={`mailto:${brand.email}`}>{brand.email}</a>
          </small>
        </div>

        <p className={s.foot}>
          Automated check of publicly available pages on {date}. Speed data from Google PageSpeed Insights
          {a?.aeo ? `; AI answers from ${and(a.aeo.engines.map((e) => ENGINE[e]))}` : ""}. {brand.identityLine}.{" "}
          <a href={`/u/${lead.slug}`}>Don&apos;t contact me again</a>
        </p>
      </div>
      {lead.source === "inbound" && <GoogleTag />}
    </div>
  );
}
