/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
import { readFileSync } from "fs";

/**
 * The portal's release version, from package.json, and the commit it was
 * built from. Shown in the sidebar and written into every export manifest, so
 * an exported file can be traced to the exact code that produced it.
 * Vercel provides the commit SHA at build time; elsewhere, git does.
 */
const appVersion: string = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8")).version;

function buildCommit(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel;
  try {
    return execSync("git rev-parse HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT__: JSON.stringify(buildCommit()),
  },
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
