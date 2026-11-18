import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
  // Phase 1: SPA talks to Supabase directly — no /api proxy to the retired D1 Worker.
});
