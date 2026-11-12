import { videoUrl } from "@/lib/booking";
import { availabilityFromEnv } from "@/lib/booking/slots";
import { brand } from "@/lib/brand";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

// Read-only view of how the app is configured. Values come from environment variables
// (.env locally, Project Settings → Environment Variables on Vercel). Secrets are never shown.

const has = (k: string) => !!process.env[k]?.trim();

const INTEGRATIONS = [
  { key: "SUPABASE_SERVICE_ROLE_KEY", name: "Supabase", use: "Database", required: true },
  { key: "ANTHROPIC_API_KEY", name: "Claude (Anthropic)", use: "Writes emails, triages replies, reads lead websites", required: true },
  { key: "GOOGLE_PLACES_API_KEY", name: "Google Places", use: "Import leads from a Google Maps search" },
  { key: "COMPANIES_HOUSE_API_KEY", name: "Companies House", use: "Import new companies, PECR checks" },
  { key: "HUNTER_API_KEY", name: "Hunter", use: "Find and verify email addresses" },
  { key: "PAGESPEED_API_KEY", name: "Google PageSpeed", use: "Mobile speed scores (works at low volume without a key)" },
  { key: "OPENAI_API_KEY", name: "ChatGPT (OpenAI)", use: "AI-mentions audit" },
  { key: "PERPLEXITY_API_KEY", name: "Perplexity", use: "AI-mentions audit" },
  { key: "GEMINI_API_KEY", name: "Gemini (Google)", use: "AI-mentions audit" },
];

/** Probe the tables/columns each migration adds; PostgREST errors if they're missing. */
async function migrationStatus() {
  const ok = async (q: PromiseLike<{ error: unknown }>) => !(await q).error;
  const [m1, m2, m3, m4, m5] = await Promise.all([
    ok(db().from("leads").select("id").limit(1)),
    ok(db().from("leads").select("aeo_mention_rate").limit(1)),
    ok(db().from("leads").select("audit_note").limit(1)),
    ok(db().from("bookings").select("id").limit(1)),
    ok(db().from("admin_users").select("id").limit(1)),
  ]);
  return [
    { file: "0001_init.sql", what: "Core tables: leads, campaigns, mailboxes, messages", ok: m1 },
    { file: "0002_aeo_mentions.sql", what: "AI-mentions audit columns", ok: m2 },
    { file: "0003_page_note.sql", what: "Personal note on audit pages", ok: m3 },
    { file: "0004_bookings.sql", what: "Built-in booking page", ok: m4 },
    { file: "0005_admin_users.sql", what: "Dashboard logins stored in the database", ok: m5 },
  ];
}

function Status({ ok, required }: { ok: boolean; required?: boolean }) {
  if (ok) return <span className="pill good">Connected</span>;
  return <span className={`pill ${required ? "bad" : ""}`}>{required ? "Missing (required)" : "Not set"}</span>;
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v || <span className="muted">not set</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function Settings() {
  const migrations = await migrationStatus();
  const dbOk = migrations.every((m) => m.ok);
  const a = availabilityFromEnv();
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">
            How the app is configured. To change anything, edit the environment variables (<code>.env</code> locally, or Vercel →
            Project Settings → Environment Variables) and redeploy. Secret keys are never shown here.
          </p>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Database</h2>
          {dbOk ? <span className="pill good">Up to date</span> : <span className="pill bad">Setup incomplete</span>}
        </div>
        <table className="plain">
          <tbody>
            {migrations.map((m) => (
              <tr key={m.file}>
                <td>
                  <code>{m.file}</code>
                </td>
                <td className="muted">{m.what}</td>
                <td style={{ textAlign: "right" }}>{m.ok ? <span className="pill good">Applied</span> : <span className="pill bad">Not run</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!dbOk && (
          <p className="muted small" style={{ marginTop: 12 }}>
            Open Supabase → SQL Editor → New query, paste the missing files from <code>supabase/migrations/</code>, and click Run.
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Integrations</h2>
          <span className="muted small">{INTEGRATIONS.filter((i) => has(i.key)).length} of {INTEGRATIONS.length} connected</span>
        </div>
        <table className="plain">
          <tbody>
            {INTEGRATIONS.map((i) => (
              <tr key={i.key}>
                <td>
                  <b>{i.name}</b>
                  <div className="muted small">{i.use}</div>
                </td>
                <td className="muted small">
                  <code>{i.key}</code>
                </td>
                <td style={{ textAlign: "right" }}>
                  <Status ok={has(i.key)} required={i.required} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="settings-cols">
        <section className="card">
          <div className="card-head">
            <h2>App</h2>
          </div>
          <Rows
            rows={[
              ["Public URL", env.appUrl],
              ["Dashboard login", "admin_users table (add one with admin_set_password in the SQL editor)"],
              ["Claude model", env.anthropicModel],
              ["Cron secret", has("CRON_SECRET") ? "Set" : <span className="pill bad">Missing</span>],
              ["Weekly report to", env.reportTo()],
              ["Pipeline", "Every 10 minutes (/api/cron/tick)"],
              ["Weekly report", "Mondays 07:00 UTC (/api/cron/weekly)"],
            ]}
          />
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Booking page</h2>
          </div>
          <Rows
            rows={[
              ["Days", a.days.map((d) => days[d - 1]).join(", ")],
              ["Hours", `${hour(a.startHour)}–${hour(a.endHour)} (${a.timezone})`],
              ["Slot length", `${a.slotMinutes} minutes`],
              ["Minimum notice", `${a.minNoticeHours} hours`],
              ["Bookable ahead", `${a.daysAhead} days`],
              ["Video call link", videoUrl()],
              ["Alerts to", process.env.BOOKING_NOTIFY_EMAIL || env.reportTo()],
            ]}
          />
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Brand</h2>
          </div>
          <Rows
            rows={[
              ["Name", brand.name],
              ["Tagline", brand.tagline],
              ["Website", brand.url],
              ["Signs as", `${brand.person}, ${brand.personRole}`],
              ["Email", brand.email],
              ["Phone", brand.phone],
              ["Footer line", brand.identityLine],
            ]}
          />
        </section>
      </div>
    </>
  );
}
