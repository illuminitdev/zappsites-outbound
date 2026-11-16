import { brand } from "@/lib/brand";
import s from "./book.module.css";

/** Top bar for the public booking pages, using the same logo as the admin portal. */
export function BookHeader() {
  return (
    <header className={s.top}>
      <div className={s.topInner}>
        <a href={brand.url} className={s.logo}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/zappsites-outbound-logo.png" alt={brand.name} />
        </a>
        <span className={s.topTag}>{brand.tagline}</span>
      </div>
    </header>
  );
}
