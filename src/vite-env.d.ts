/// <reference types="vite/client" />

/** package.json `version`, injected at build time by vite.config.ts. */
declare const __APP_VERSION__: string;
/** Full SHA of the commit the bundle was built from, or "unknown". */
declare const __APP_COMMIT__: string;
