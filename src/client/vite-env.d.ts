/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** "production" | "staging" | "local". Unset means production. See src/client/lib/env.ts. */
  readonly VITE_APP_ENV?: string;
  /** Demo-account password for one-click sign-in. Staging, preview and local only — never set in production. */
  readonly VITE_DEMO_PASSWORD?: string;
  /** Short build id shown on the staging ribbon (commit SHA prefix). */
  readonly VITE_BUILD_ID?: string;
  /** Optional git branch for preview ribbon label (`PREVIEW · <branch>`). */
  readonly VITE_GIT_BRANCH?: string;
  /** Office phone shown for urgent help. Unset renders "To be confirmed". See src/client/lib/support-contact.ts. */
  readonly VITE_SUPPORT_OFFICE_PHONE?: string;
  /** Office email shown for urgent help. */
  readonly VITE_SUPPORT_OFFICE_EMAIL?: string;
  /** After-hours phone line shown for urgent help. */
  readonly VITE_SUPPORT_AFTER_HOURS_PHONE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
