import type { Metadata } from "next";
import { BookingPage } from "../BookingPage";
import { brand } from "@/lib/brand";
import { db } from "@/lib/db";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Book a call · ${brand.name}`, robots: { index: false, follow: false } };

export default async function BookForLead({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ day?: string; error?: string }> }) {
  const { slug } = await params;
  const { day, error } = await searchParams;
  const { data: lead } = await db().from("leads").select("*").eq("slug", slug).maybeSingle<Lead>();
  return <BookingPage lead={lead ?? null} day={day} error={error} base={`/book/${slug}`} />;
}
