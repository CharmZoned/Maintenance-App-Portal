/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** "production" | "staging" | "local". Unset means production. See src/client/lib/env.ts. */
  readonly VITE_APP_ENV?: string;
  /** Demo-account password for one-click sign-in. Staging, preview and local only — never set in production. */
  readonly VITE_DEMO_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
