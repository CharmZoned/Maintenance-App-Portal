/**
 * Shared helpers for requirement + workflow tests.
 *
 * Two ways to act as a user:
 *   - `signInApp("tenant")` signs the APP'S OWN Supabase client in, so calls into
 *     src/client/lib/data.ts run exactly as they do in the browser.
 *   - `clientFor("tenant")` returns a separate signed-in client for checking what
 *     the database itself allows (RLS), independent of the app's code.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { supabase as appClient } from "@/lib/supabase";
import { ANON_KEY, SERVICE_ROLE_KEY } from "../emulator/jwt";
import type { Mail } from "../emulator/auth";
import { PASSWORD, PERSONAS, type PersonaKey, type World } from "../emulator/seed";
import { EMULATOR_URL } from "./ports";

export { PASSWORD, PERSONAS };
export type { PersonaKey, World };

async function control<T>(route: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${EMULATOR_URL}/__emulator${route}`, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new Error(`emulator ${route}: ${json.message ?? res.status}`);
  return json;
}

/** Wipe the database and load the standard test world (see tests/emulator/seed.ts). */
export async function resetWorld(): Promise<World> {
  await appClient.auth.signOut({ scope: "local" });
  const { world } = await control<{ world: World }>("/reset", { method: "POST", body: { seed: true } });
  return world;
}

/** Superuser SQL — the equivalent of the Supabase SQL editor. For fixtures and assertions only. */
export async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await control<{ rows: T[] }>("/sql", { method: "POST", body: { query, params } });
  return rows;
}

/** Emails the auth layer "sent" (sign-up confirmation, password recovery). */
export async function outbox(): Promise<Mail[]> {
  return (await control<{ mail: Mail[] }>("/outbox")).mail;
}

export async function setAutoconfirm(autoconfirm: boolean): Promise<void> {
  await control("/config", { method: "POST", body: { autoconfirm } });
}

function freshClient(key: string): SupabaseClient {
  return createClient(EMULATOR_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Not signed in at all (only the public anon key). */
export function anonClient(): SupabaseClient {
  return freshClient(ANON_KEY);
}

/** Bypasses RLS. Stands in for the website backend / an operator; the portal never has this key. */
export function serviceClient(): SupabaseClient {
  return freshClient(SERVICE_ROLE_KEY);
}

export async function clientForLogin(email: string, password = PASSWORD): Promise<SupabaseClient> {
  const client = freshClient(ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

export function clientFor(persona: PersonaKey): Promise<SupabaseClient> {
  return clientForLogin(PERSONAS[persona].email);
}

/** Sign the app's own client in as a persona; data-layer calls then run as that user. */
export async function signInApp(persona: PersonaKey | { email: string; password?: string }): Promise<void> {
  const email = typeof persona === "string" ? PERSONAS[persona].email : persona.email;
  const password = typeof persona === "string" ? PASSWORD : (persona.password ?? PASSWORD);
  await appClient.auth.signOut({ scope: "local" });
  const { error } = await appClient.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
}

export async function signOutApp(): Promise<void> {
  await appClient.auth.signOut({ scope: "local" });
}

/** Follow an emailed link (sign-up confirmation / recovery) and return the session it grants. */
export async function followMailLink(link: string): Promise<{ access_token: string; refresh_token: string; type: string }> {
  const res = await fetch(link, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  const hash = new URLSearchParams(location.split("#")[1] ?? "");
  const access_token = hash.get("access_token");
  if (!access_token) throw new Error(`mail link did not grant a session: ${location}`);
  return { access_token, refresh_token: hash.get("refresh_token") ?? "", type: hash.get("type") ?? "" };
}

type Result = { data: unknown; error: { message: string; code?: string } | null };

/**
 * A write/read was refused. Postgres refuses in two shapes: an error, or (for
 * RLS-filtered UPDATE/DELETE/SELECT) silently touching zero rows.
 */
export function expectDenied(result: Result, why?: string): void {
  const rows = Array.isArray(result.data) ? result.data.length : result.data == null ? 0 : 1;
  expect(result.error !== null || rows === 0, why ?? "expected the database to refuse this").toBe(true);
}

export function expectOk<T extends Result>(result: T, why?: string): NonNullable<T["data"]> {
  expect(result.error, `${why ?? "expected success"}: ${result.error?.message ?? ""}`).toBeNull();
  return result.data as NonNullable<T["data"]>;
}

/** A tiny valid PNG, for photo uploads. */
export function pngFile(name = "photo.png"): File {
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  return new File([bytes], name, { type: "image/png" });
}

export function pdfFile(name = "lease.pdf"): File {
  return new File([Buffer.from("%PDF-1.4\n% test document\n")], name, { type: "application/pdf" });
}

export function tomorrow(): string {
  return new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
}
