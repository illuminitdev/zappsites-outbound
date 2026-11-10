import type { Metadata } from "next";
import { startCheck } from "@/app/actions";
import { GoogleTag } from "@/components/GoogleTag";
import { brand } from "@/lib/brand";
import { TRADES, tradeById } from "@/lib/inbound";
import s from "./check.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ trade?: string }> }): Promise<Metadata> {
  const t = tradeById((await searchParams).trade);
  return {
    title: `Free website check${t?.category ? ` for ${t.category}` : ""} · ${brand.name}`,
    description: "See how your website does on phones, on Google and in ChatGPT answers. Free, about a minute, report emailed to you.",
  };
}

export default async function Check({ searchParams }: { searchParams: Promise<{ trade?: string; error?: string; gclid?: string; town?: string }> }) {
  const { trade, error, gclid, town } = await searchParams;
  const t = tradeById(trade);
  const who = t && t.id !== "other" ? t.category : "local businesses";

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
        <div className={s.grid}>
          <div>
            <p className={s.eyebrow}>Free check for {who}</p>
            <h1 className={s.title}>Is your website losing you jobs?</h1>
            <p className={s.lede}>
              Find out how your site does on a phone, on Google, and whether ChatGPT recommends you when customers ask. Takes about a minute.
            </p>
            <ul className={s.points}>
              <li>
                <b>Mobile speed</b>, tested by Google
              </li>
              <li>
                <b>Google basics</b>: headline, description, click-to-call, quote button
              </li>
              <li>
                <b>AI answers</b>: we ask ChatGPT, Claude, Perplexity and Gemini for {who} near you
              </li>
              <li>
                <b>The 3 fixes</b> that would win you the most work
              </li>
            </ul>
            <p className={s.price}>
              If you want help afterwards: <b>websites from £39/month with no build fee</b>, online booking from £29/month. No pressure, the report is yours either way.
            </p>
          </div>

          <form action={startCheck} className={s.card}>
            <h2>Get your free report</h2>
            <p>Shown on screen and emailed to you.</p>
            {error && <div className={s.error}>{error}</div>}
            <input type="hidden" name="gclid" value={gclid ?? ""} />
            <label className={s.field}>
              <span>Your website</span>
              <input name="website" required placeholder="yourbusiness.co.uk" inputMode="url" autoComplete="url" />
            </label>
            <div className={s.row}>
              <label className={s.field}>
                <span>Business name</span>
                <input name="company" required autoComplete="organization" />
              </label>
              <label className={s.field}>
                <span>Town or city</span>
                <input name="town" required defaultValue={town ?? ""} placeholder="e.g. Leeds" />
              </label>
            </div>
            <label className={s.field}>
              <span>What do you do?</span>
              <select name="trade" defaultValue={t?.id ?? ""} required>
                <option value="" disabled>
                  Choose one
                </option>
                {TRADES.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <div className={s.row}>
              <label className={s.field}>
                <span>Your name</span>
                <input name="name" required autoComplete="name" />
              </label>
              <label className={s.field}>
                <span>Email (for the report)</span>
                <input name="email" type="email" required autoComplete="email" />
              </label>
            </div>
            <label className={s.field}>
              <span>Phone (optional)</span>
              <input name="phone" type="tel" autoComplete="tel" />
            </label>
            <button className={s.btn}>Check my website</button>
            <p className={s.small}>
              We&apos;ll email you the report and may follow up once about it. {brand.identityLine}.
            </p>
          </form>
        </div>
      </div>
      <GoogleTag />
    </div>
  );
}
