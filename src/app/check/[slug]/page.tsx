import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Conversion, GoogleTag } from "@/components/GoogleTag";
import { brand } from "@/lib/brand";
import { db } from "@/lib/db";
import s from "../check.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Checking your website · ${brand.name}`, robots: { index: false, follow: false } };

/** Holding page while the audit runs; refreshes itself, then hands over to the report. */
export default async function Running({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ n?: string }> }) {
  const { slug } = await params;
  const n = Number((await searchParams).n ?? 0);
  const { data: lead } = await db().from("leads").select("status,domain").eq("slug", slug).maybeSingle<{ status: string; domain: string }>();
  if (!lead) redirect("/check");
  const done = lead.status !== "enriched" && lead.status !== "new";

  return (
    <div className={s.page}>
      {!done && <meta httpEquiv="refresh" content={`4;url=/check/${slug}?n=${n + 1}`} />}
      <div className={s.running}>
        {done ? (
          <>
            {/* Conversion fires here once, then the visitor goes to the report. */}
            <Conversion label={process.env.NEXT_PUBLIC_ADS_LABEL_CHECK} event="generate_lead" />
            <meta httpEquiv="refresh" content={`1;url=/p/${slug}`} />
            <h1>Your report is ready</h1>
            <p>
              <a href={`/p/${slug}`}>Open it now</a>. We&apos;ve emailed you a copy too.
            </p>
          </>
        ) : n > 40 ? (
          <>
            <h1>This is taking longer than usual</h1>
            <p>We&apos;ll email your report to you as soon as it&apos;s finished. You can close this page.</p>
          </>
        ) : (
          <>
            <div className={s.spinner} />
            <h1>Checking {lead.domain}</h1>
            <p>This usually takes about a minute.</p>
            <div className={s.steps}>
              {["Testing speed on a phone with Google", "Checking what Google sees", "Asking AI assistants who they recommend", "Picking your top 3 fixes"].map((t, i) => (
                <div key={t}>{n >= i * 3 ? "✓" : "·"} {t}</div>
              ))}
            </div>
          </>
        )}
      </div>
      <GoogleTag />
    </div>
  );
}
