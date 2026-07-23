"use client";
// "use client" = this component runs IN THE BROWSER (it has state and
// click handlers). Server components (the default) can't use useState.
//
// PRODUCTION DEBUG MAP: "can't log in" → this file, then Supabase
// dashboard → Auth → Users (is the user there? confirmed?).
// "can't set up account" / OTP issues → app/api/account/*.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type PendingUser = { id: string; full_name: string };

// Account setup (2026-07-23, V2) is admin-provisioned, not open
// self-signup: the owner adds a name+email to pending_users (SQL
// Editor), the person picks their name here, sets a password, then
// verifies a one-time emailed code — see app/api/account/activate and
// app/api/account/verify. This replaces the old plain-signup /
// Zoho-user-dropdown designs entirely.
type Mode = "signin" | "setup-details" | "setup-code";

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("signin");
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [pendingUsersError, setPendingUsersError] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fetched once, on entering setup mode — not on every keystroke.
  useEffect(() => {
    if (mode !== "setup-details" || pendingUsers.length > 0) return;
    fetch("/api/account/pending")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setPendingUsersError(data.error);
        } else {
          setPendingUsers(data.users);
        }
      })
      .catch(() => setPendingUsersError("Could not load the name list."));
  }, [mode, pendingUsers.length]);

  async function handleSignIn(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    // Client created HERE (lazily), not at render time — so the build's
    // prerender pass never needs env keys. Lesson from our first build failure.
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }

    // Success: session cookie is set. router.refresh() makes the server
    // re-read cookies so proxy.ts sees the new session immediately.
    router.push("/");
    router.refresh();
  }

  async function handleSetupDetails(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const res = await fetch("/api/account/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pendingUserId, password }),
    });
    const data = await res.json();

    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }

    setEmail(data.email);
    setMode("setup-code");
  }

  async function handleSetupCode(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const res = await fetch("/api/account/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json();

    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }

    // The server route sets the session cookie directly (verifyOtp via
    // the cookie-aware server client) — refresh is enough, no client
    // sign-in call needed.
    router.push("/");
    router.refresh();
  }

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-bold text-brand-blue-dark">
          Dream 100
        </h1>
        <p className="mb-8 text-center text-sm text-zinc-500">
          Ecoste Sales Intelligence
        </p>

        {mode === "signin" && (
          <form
            onSubmit={handleSignIn}
            className="space-y-4 rounded-2xl bg-white p-6 shadow-sm"
          >
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-zinc-700">
                Work email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-brand-blue"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-zinc-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-brand-blue"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-green py-3 text-base font-semibold text-white transition-colors hover:bg-brand-green-dark disabled:opacity-50"
            >
              {busy && <Spinner />}
              {busy ? "Please wait…" : "Sign in"}
            </button>

            <button
              type="button"
              onClick={() => switchTo("setup-details")}
              className="w-full text-center text-sm text-brand-blue underline-offset-2 hover:underline"
            >
              First time? Set up your account
            </button>
          </form>
        )}

        {mode === "setup-details" && (
          <form
            onSubmit={handleSetupDetails}
            className="space-y-4 rounded-2xl bg-white p-6 shadow-sm"
          >
            <div>
              <label htmlFor="pendingUser" className="mb-1 block text-sm font-medium text-zinc-700">
                Your name
              </label>
              <select
                id="pendingUser"
                required
                value={pendingUserId}
                onChange={(e) => setPendingUserId(e.target.value)}
                disabled={pendingUsers.length === 0}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base outline-none focus:border-brand-blue disabled:opacity-50"
              >
                <option value="" disabled>
                  {pendingUsersError
                    ? "Could not load names"
                    : pendingUsers.length === 0
                      ? "Loading…"
                      : "Select your name"}
                </option>
                {pendingUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-zinc-400">
                {pendingUsersError ??
                  "Not on the list? Ask the owner to add you first."}
              </p>
            </div>

            <div>
              <label htmlFor="newPassword" className="mb-1 block text-sm font-medium text-zinc-700">
                Choose a password
              </label>
              <input
                id="newPassword"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-brand-blue"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <button
              type="submit"
              disabled={busy || !pendingUserId}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-green py-3 text-base font-semibold text-white transition-colors hover:bg-brand-green-dark disabled:opacity-50"
            >
              {busy && <Spinner />}
              {busy ? "Please wait…" : "Continue"}
            </button>

            <button
              type="button"
              onClick={() => switchTo("signin")}
              className="w-full text-center text-sm text-brand-blue underline-offset-2 hover:underline"
            >
              Already set up? Sign in
            </button>
          </form>
        )}

        {mode === "setup-code" && (
          <form
            onSubmit={handleSetupCode}
            className="space-y-4 rounded-2xl bg-white p-6 shadow-sm"
          >
            <div>
              <p className="mb-3 text-sm text-zinc-600">
                We sent a code to <span className="font-medium text-zinc-900">{email}</span>.
                Enter it below to finish setting up your account.
              </p>
              <label htmlFor="code" className="mb-1 block text-sm font-medium text-zinc-700">
                Verification code
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                required
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-brand-blue"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-green py-3 text-base font-semibold text-white transition-colors hover:bg-brand-green-dark disabled:opacity-50"
            >
              {busy && <Spinner />}
              {busy ? "Please wait…" : "Verify and continue"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

// Indeterminate CSS-only spinner — plan.md §10 Phase 0c's other ask
// (real loading feedback during the auth network call, not just
// disabled-button text). No new dependency.
function Spinner() {
  return (
    <span
      aria-hidden
      className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  );
}
