"use client";
// "use client" = this component runs IN THE BROWSER (it has state and
// click handlers). Server components (the default) can't use useState.
//
// PRODUCTION DEBUG MAP: "can't log in / can't sign up" → this file first,
// then Supabase dashboard → Auth → Users (is the user there? confirmed?).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type ZohoUser = { id: string; fullName: string; email: string };

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [zohoUsers, setZohoUsers] = useState<ZohoUser[]>([]);
  const [zohoUsersError, setZohoUsersError] = useState<string | null>(null);
  const [zohoUserId, setZohoUserId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fetched once, on entering signup mode — not on every keystroke.
  // A salesperson picks their own name from real Zoho users instead of
  // typing it, so sync matching by zoho_user_id (§Phase 1) can never
  // be broken by a typo.
  useEffect(() => {
    if (mode !== "signup" || zohoUsers.length > 0) return;
    fetch("/api/zoho/users")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setZohoUsersError(data.error);
        } else {
          setZohoUsers(data.users);
        }
      })
      .catch(() => setZohoUsersError("Could not load the salesperson list."));
  }, [mode, zohoUsers.length]);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault(); // stop the browser's default full-page form POST
    setError(null);
    setBusy(true);

    // Client created HERE (lazily), not at render time — so the build's
    // prerender pass never needs env keys. Lesson from our first build failure.
    const supabase = createClient();

    // On signup we send full_name + zoho_user_id as metadata — the
    // handle_new_user trigger (migration 004) reads both and stores
    // them on the users row. zoho_user_id is the stable match key the
    // sync uses to set assigned_user_id on the salesperson's accounts.
    const selectedUser = zohoUsers.find((u) => u.id === zohoUserId);
    const { error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                full_name: selectedUser?.fullName ?? "",
                zoho_user_id: zohoUserId,
              },
            },
          });

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

  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-bold text-zinc-900">
          Dream 100
        </h1>
        <p className="mb-8 text-center text-sm text-zinc-500">
          Ecoste Sales Intelligence
        </p>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl bg-white p-6 shadow-sm"
        >
          {mode === "signup" && (
            <div>
              <label
                htmlFor="zohoUser"
                className="mb-1 block text-sm font-medium text-zinc-700"
              >
                Your name (from Zoho)
              </label>
              <select
                id="zohoUser"
                required
                value={zohoUserId}
                onChange={(e) => setZohoUserId(e.target.value)}
                disabled={zohoUsers.length === 0}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base outline-none focus:border-zinc-900 disabled:opacity-50"
              >
                <option value="" disabled>
                  {zohoUsersError
                    ? "Could not load names"
                    : zohoUsers.length === 0
                      ? "Loading…"
                      : "Select your name"}
                </option>
                {zohoUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-zinc-400">
                {zohoUsersError
                  ? zohoUsersError
                  : "This links your Zoho clients to your account"}
              </p>
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-zinc-700"
            >
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
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-zinc-900"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-zinc-700"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-zinc-900"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-zinc-900 py-3 text-base font-semibold text-white disabled:opacity-50"
          >
            {busy
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
            }}
            className="w-full text-center text-sm text-zinc-500 underline-offset-2 hover:underline"
          >
            {mode === "signin"
              ? "First time? Create your account"
              : "Already registered? Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
