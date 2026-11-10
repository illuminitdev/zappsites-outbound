import type { Metadata } from "next";
import { confirmUnsubscribe } from "@/app/actions";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

// Unsubscribing needs a click (POST), because corporate link scanners open every URL in an email.
export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ done?: string }> }) {
  const { slug } = await params;
  const { done } = await searchParams;
  return (
    <main style={{ maxWidth: 460, margin: "80px auto", padding: 20 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={brand.logoUrl} alt={brand.name} height={26} style={{ marginBottom: 28 }} />
      {done ? (
        <>
          <h1 style={{ fontSize: 22 }}>Done, you won&apos;t hear from us again.</h1>
          <p>Sorry for the interruption.</p>
        </>
      ) : (
        <form action={confirmUnsubscribe}>
          <h1 style={{ fontSize: 22 }}>Stop emails from {brand.name}?</h1>
          <input type="hidden" name="slug" value={slug} />
          <button style={{ background: brand.accent }}>Yes, unsubscribe me</button>
        </form>
      )}
    </main>
  );
}
