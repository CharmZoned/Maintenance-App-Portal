import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const buildId =
  process.env.VITE_BUILD_ID?.trim() ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  process.env.GITHUB_SHA?.slice(0, 7) ||
  "local";

const gitBranch =
  process.env.VITE_GIT_BRANCH?.trim() ||
  process.env.VERCEL_GIT_COMMIT_REF?.trim() ||
  "";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind IPv4 so Cloud Agent / browser previews on 127.0.0.1 work
    // (default Vite listen can be IPv6-only ::1 on this host).
    host: "127.0.0.1",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/client"),
    },
  },
  // Staging ribbon labels — safe in production (ribbon never mounts there).
  define: {
    __STAGING_BUILD_ID__: JSON.stringify(buildId),
    __STAGING_GIT_BRANCH__: JSON.stringify(
      process.env.VERCEL_ENV === "preview" ? gitBranch : "",
    ),
  },
  // Phase 1: SPA talks to Supabase directly — no /api proxy to the retired D1 Worker.
});
