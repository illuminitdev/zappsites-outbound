import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import { login } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in · Outbound engine", robots: { index: false, follow: false } };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  return (
    <div className="login">
      <form action={login} className="card login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logoUrl} alt={brand.name} className="login-logo" />
        <h1>Outbound engine</h1>
        <p className="muted">Sign in to continue.</p>
        {error && <div className="login-error">Wrong username or password.</div>}
        <input type="hidden" name="next" value={next ?? "/"} />
        <label htmlFor="username">Username</label>
        <input id="username" name="username" autoComplete="username" required autoFocus />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        <button className="login-btn">Sign in</button>
      </form>
    </div>
  );
}
