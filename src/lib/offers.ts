// ZappSites packages (from zappsites.com/pricing) and the "what we'd fix" plan built from an audit.
// Edit prices here when the pricing page changes.

import type { Audit, AuditCheck } from "./types";

export interface Offer {
  id: "essential" | "booking_solo" | "local_presence" | "local_growth" | "complete";
  name: string;
  price: number; // per month
  term: string;
  blurb: string;
}

export const OFFERS: Record<Offer["id"], Offer> = {
  essential: {
    id: "essential",
    name: "Website Essential",
    price: 39,
    term: "12-month minimum, no upfront build fee, the site is yours after the term",
    blurb: "A fast, mobile-first site with Home, About, Services, Coverage and Contact pages, hosting, SSL, backups and core technical SEO.",
  },
  booking_solo: {
    id: "booking_solo",
    name: "Booking Solo",
    price: 29,
    term: "monthly",
    blurb: "Online booking or quote requests with confirmations and reminders.",
  },
  local_presence: {
    id: "local_presence",
    name: "Local Presence",
    price: 99,
    term: "6-month minimum",
    blurb: "Google Business Profile set up and managed: services, areas, hours, review replies and monthly posts.",
  },
  local_growth: {
    id: "local_growth",
    name: "Local Growth",
    price: 199,
    term: "6-month minimum",
    blurb: "Everything in Local Presence plus local SEO, service and area pages, structured data, directory consistency and AI-answer content.",
  },
  complete: {
    id: "complete",
    name: "Complete Growth System",
    price: 249,
    term: "12-month minimum",
    blurb: "Website Essential, Booking Pro and Local Growth together, with call, form and booking tracking. £68 a month less than buying them separately.",
  },
};

/** Which package fixes which check. */
const FIXED_BY: Record<string, Offer["id"]> = {
  reachable: "essential",
  https: "essential",
  mobile: "essential",
  mobile_speed: "essential",
  response_time: "essential",
  title: "essential",
  meta_description: "essential",
  h1: "essential",
  cta: "essential",
  click_to_call: "essential",
  freshness: "essential",
  alt_text: "essential",
  sitemap: "essential",
  service_areas: "essential",
  nap: "essential",
  indexable: "essential",
  canonical: "essential",
  redirects: "essential",
  broken_links: "essential",
  mixed_content: "essential",
  hsts: "essential",
  not_found: "essential",
  headings: "essential",
  lang: "essential",
  og_tags: "essential",
  favicon: "essential",
  image_formats: "essential",
  contact_form: "essential",
  accreditations: "essential",
  reviews: "essential",
  opening_hours: "essential",
  social_links: "essential",
  privacy_policy: "essential",
  pricing_signal: "essential",
  whatsapp: "essential",
  online_booking: "booking_solo",
  email_auth: "local_growth",
  maps_link: "local_growth",
  faq: "local_growth",
  blog: "local_growth",
  content_depth: "local_growth",
  ai_mentions: "local_growth",
  schema: "local_growth",
  ai_crawlers: "local_growth",
  llms_txt: "local_growth",
  local_headline: "local_growth",
  service_pages: "local_growth",
};

// Failing any of these means the site itself needs rebuilding, not tweaking.
const REBUILD = new Set(["reachable", "https", "mobile", "mobile_speed"]);

export interface PlanStep {
  offer: Offer;
  fixes: AuditCheck[];
}

export interface FixPlan {
  steps: PlanStep[];
  monthly: number;
  bundle: Offer | null; // suggested instead when it's close in price and covers more
  noWebsite: boolean;
}

export function fixPlan(a: Audit | null): FixPlan {
  // No site at all: the offer is the website itself, plus being found.
  if (!a || !a.url) {
    const steps: PlanStep[] = [{ offer: OFFERS.essential, fixes: [] }];
    if (a?.aeo && a.aeo.mentionRate < 50) steps.push({ offer: OFFERS.local_growth, fixes: a.checks.filter((c) => c.id === "ai_mentions") });
    const monthly = steps.reduce((t, s) => t + s.offer.price, 0);
    return { steps, monthly, bundle: steps.length > 1 ? OFFERS.complete : null, noWebsite: true };
  }

  const failing = a.checks.filter((c) => !c.pass && !c.unverified);
  const byOffer = new Map<Offer["id"], AuditCheck[]>();
  for (const c of failing) {
    const id = FIXED_BY[c.id];
    if (!id) continue;
    byOffer.set(id, [...(byOffer.get(id) ?? []), c]);
  }

  // A site that only fails one or two minor website checks doesn't need a new site:
  // Local Growth covers on-page fixes like that.
  const site = byOffer.get("essential") ?? [];
  const needsRebuild = site.some((c) => REBUILD.has(c.id)) || site.filter((c) => c.impact !== "low").length >= 3;
  if (site.length && !needsRebuild) {
    byOffer.delete("essential");
    byOffer.set("local_growth", [...(byOffer.get("local_growth") ?? []), ...site]);
  }

  const order: Offer["id"][] = ["essential", "local_growth", "booking_solo"];
  const steps = order.filter((id) => byOffer.get(id)?.length).map((id) => ({ offer: OFFERS[id], fixes: byOffer.get(id)! }));
  const monthly = steps.reduce((t, s) => t + s.offer.price, 0);
  const both = steps.some((s) => s.offer.id === "essential") && steps.some((s) => s.offer.id === "local_growth");
  return { steps, monthly, bundle: both ? OFFERS.complete : null, noWebsite: false };
}
