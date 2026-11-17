import { GoogleTag } from "@/components/GoogleTag";
import { openSlots, videoUrl } from "@/lib/booking";
import { brand } from "@/lib/brand";
import type { Lead } from "@/lib/types";
import { BookingFlow } from "./BookingFlow";

/** Shared booking page: /book (anyone) and /book/<lead slug> (prefilled from the audit). */
export async function BookingPage({ lead, day, error, base }: { lead: Lead | null; day?: string; month?: string; error?: string; base: string }) {
  const { slots, availability } = await openSlots();
  const name = [lead?.first_name, lead?.last_name].filter(Boolean).join(" ");

  return (
    <>
      <BookingFlow
        slots={slots}
        slotMinutes={availability.slotMinutes}
        initialDay={day}
        leadSlug={lead?.slug ?? ""}
        base={base}
        prefill={{ name, company: lead?.company ?? "", email: lead?.email ?? "", website: lead?.domain ?? "" }}
        video={!!videoUrl()}
        error={error}
        brandName={brand.name}
        brandUrl={brand.url}
        adsLabel={process.env.NEXT_PUBLIC_ADS_LABEL_BOOK}
        company={lead?.company ?? undefined}
        contact={`${brand.phone} · ${brand.email}`}
      />
      <GoogleTag />
    </>
  );
}
