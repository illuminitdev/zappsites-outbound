import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import { BookingPage } from "./BookingPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Book a call · ${brand.name}`, robots: { index: false, follow: false } };

export default async function Book({ searchParams }: { searchParams: Promise<{ day?: string; month?: string; error?: string }> }) {
  const { day, month, error } = await searchParams;
  return <BookingPage lead={null} day={day} month={month} error={error} base="/book" />;
}
