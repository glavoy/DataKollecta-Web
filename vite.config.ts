/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Vitest's default include matches every *.test.ts in the repo, which
    // sweeps in the Edge Function tests under supabase/functions/tests/.
    // Those are Deno: they import over https, which Node's ESM loader refuses
    // outright ("Only URLs with a scheme in: file and data are supported").
    // They have their own runner -- `npm run test:functions`.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
}));
