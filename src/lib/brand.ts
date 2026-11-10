// Prospect-facing brand. Everything a prospect sees (emails, audit page, unsubscribe page) uses this.
// Defaults are ZappSites' public details; override any of them with env vars.

const v = (k: string, d: string) => process.env[k]?.trim() || d;

export const brand = {
  get name() {
    return v("BRAND_NAME", "ZappSites");
  },
  get tagline() {
    return v("BRAND_TAGLINE", "Get found. Get booked. Get paid.");
  },
  get url() {
    return v("BRAND_URL", "https://www.zappsites.com");
  },
  get logoUrl() {
    return v("BRAND_LOGO_URL", "https://zappsites-prod-uploads-288761766237.s3.us-east-1.amazonaws.com/images/brand/logo.png");
  },
  /** Brand accent colour used for links, buttons and highlights. */
  get accent() {
    return v("BRAND_ACCENT", "#1d4ed8");
  },
  get email() {
    return v("BRAND_EMAIL", "info@zappsites.com");
  },
  get phone() {
    return v("BRAND_PHONE", "020 3488 6301");
  },
  get address() {
    return v("BRAND_ADDRESS", process.env.SENDER_ADDRESS || "160 City Road, London EC1V 2NX");
  },
  /** The person who "signs" the audit page and emails. */
  get person() {
    return v("BRAND_PERSON", "Ram");
  },
  get personRole() {
    return v("BRAND_PERSON_ROLE", "Founder");
  },
  /** Legal entity, if ZappSites is a trading name (PECR/Companies Act: say who you are). */
  get legalName() {
    return process.env.SENDER_COMPANY?.trim() || "";
  },
  /** One line for footers: "ZappSites, 160 City Road, London EC1V 2NX" (+ legal entity if different). */
  get identityLine() {
    const legal = this.legalName && this.legalName.toLowerCase() !== this.name.toLowerCase() ? ` (a trading name of ${this.legalName})` : "";
    return `${this.name}${legal}, ${this.address}`;
  },
};
