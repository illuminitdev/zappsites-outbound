// Central, lazy access to configuration so modules can be imported in tests without env.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const env = {
  /**
   * Public base URL for links in emails and pages.
   * 1. APP_URL, if set to a real address (a "localhost" value is ignored on Vercel).
   * 2. On Vercel: the project's production domain (your custom domain if one is set, e.g. audit.zappsites.com).
   * 3. Locally: http://localhost:3000.
   */
  get appUrl() {
    const strip = (u: string) => u.trim().replace(/\/$/, "");
    const set = process.env.APP_URL?.trim();
    const onVercel = !!process.env.VERCEL;
    if (set && !(onVercel && /localhost|127\.0\.0\.1/.test(set))) return strip(set);
    const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    if (vercelHost) return strip(`https://${vercelHost.replace(/^https?:\/\//, "")}`);
    return "http://localhost:3000";
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get anthropicKey() {
    return required("ANTHROPIC_API_KEY");
  },
  get anthropicModel() {
    return process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  },
  companiesHouseKey: () => process.env.COMPANIES_HOUSE_API_KEY || undefined,
  placesKey: () => process.env.GOOGLE_PLACES_API_KEY || undefined,
  hunterKey: () => process.env.HUNTER_API_KEY || undefined,
  pagespeedKey: () => process.env.PAGESPEED_API_KEY || undefined,
  get senderCompany() {
    return process.env.SENDER_COMPANY ?? "";
  },
  get senderAddress() {
    return process.env.SENDER_ADDRESS ?? "";
  },
  reportTo: () => process.env.REPORT_TO || undefined,
};
