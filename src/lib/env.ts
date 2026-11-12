// Central, lazy access to configuration so modules can be imported in tests without env.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const env = {
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
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
