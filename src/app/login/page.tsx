import type { Metadata } from "next";
import { login } from "./actions";
import { LoginButton } from "./LoginButton";
import { PasswordInput } from "./PasswordInput";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Login · ZappSites Outbound", robots: { index: false, follow: false } };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  return (
    <div className="login">
      <form action={login} className="card login-card">
        <h1>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/zappsites-outbound-logo.png" alt="ZappSites Outbound" className="login-logo" />
        </h1>
        <p className="muted">Log in to continue.</p>
        {error && <div className="login-error">Wrong username or password.</div>}
        <input type="hidden" name="next" value={next ?? "/"} />
        <label htmlFor="username">Username</label>
        <input id="username" name="username" autoComplete="username" required autoFocus />
        <label htmlFor="password">Password</label>
        <PasswordInput />
        <LoginButton />
      </form>
    </div>
  );
}
