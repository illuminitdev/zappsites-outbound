import { cookies } from "next/headers";
import { PasswordInput } from "@/app/login/PasswordInput";
import { db } from "@/lib/db";
import { SESSION_COOKIE, sessionUserId } from "@/lib/session";
import { updatePassword, updateUsername } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

async function loadUser() {
  const id = await sessionUserId((await cookies()).get(SESSION_COOKIE)?.value);
  if (!id) return null;
  const { data } = await db().from("admin_users").select("username, updated_at").eq("id", id).maybeSingle();
  return data;
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ ok, error }, user] = await Promise.all([searchParams, loadUser()]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Manage your login details.</p>
        </div>
      </div>

      {ok && <div className="form-msg good">{ok}</div>}
      {error && <div className="form-msg bad">{error}</div>}

      <div className="settings-cols">
        <section className="card">
          <div className="card-head">
            <h2>Profile</h2>
          </div>
          <form action={updateUsername}>
            <label htmlFor="username">Username</label>
            <input id="username" name="username" defaultValue={user?.username ?? ""} autoComplete="username" required />
            <label htmlFor="profile_password">Current password</label>
            <PasswordInput id="profile_password" name="current_password" />
            <div className="form-foot">
              <SubmitButton className="" pending="Saving...">Save profile</SubmitButton>
            </div>
          </form>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Password</h2>
            {user?.updated_at && <span className="muted small">Last changed {new Date(user.updated_at).toLocaleDateString("en-GB")}</span>}
          </div>
          <form action={updatePassword}>
            <label htmlFor="current_password">Current password</label>
            <PasswordInput id="current_password" />
            <label htmlFor="new_password">New password</label>
            <PasswordInput id="new_password" autoComplete="new-password" minLength={8} />
            <label htmlFor="confirm_password">Confirm new password</label>
            <PasswordInput id="confirm_password" autoComplete="new-password" minLength={8} />
            <div className="form-foot">
              <SubmitButton className="" pending="Changing...">Change password</SubmitButton>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
