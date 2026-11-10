import type { Metadata } from "next";
import { Conversion, GoogleTag } from "@/components/GoogleTag";
import { brand } from "@/lib/brand";
import { db } from "@/lib/db";
import s from "../book.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Booked · ${brand.name}`, robots: { index: false, follow: false } };

export default async function Done({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const { b } = await searchParams;
  const { data } = b
    ? await db().from("bookings").select("id,name,start_at,method,phone").eq("id", b).maybeSingle<{ id: string; name: string; start_at: string; method: string; phone: string | null }>()
    : { data: null };
  const when = data
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(data.start_at))
    : null;
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
        <div className={`${s.card} ${s.done}`}>
          <h1>You&apos;re booked{data ? `, ${data.name.split(/\s+/)[0]}` : ""}</h1>
          {when && <p>{when} (UK time), 15 minutes.</p>}
          {data?.method === "phone" && data.phone && <p>I&apos;ll call you on {data.phone}.</p>}
          <p className={s.small}>
            A calendar invite is on its way to your inbox.{" "}
            {data && <a href={`/api/public/ics/${data.id}`}>Add to calendar</a>}
          </p>
          <p className={s.small}>Need to move it? Reply to the confirmation email or call {brand.phone}.</p>
        </div>
        {data && <Conversion label={process.env.NEXT_PUBLIC_ADS_LABEL_BOOK} event="call_booked" />}
        <GoogleTag />
      </div>
    </div>
  );
}
