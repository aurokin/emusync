import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Test config lives in vitest.config.ts, which vitest prefers over this file.
// A `test` block here was silently ignored.
export default defineConfig({
    plugins: [tailwindcss(), reactRouter()],
    // Native since Vite 8; vite-tsconfig-paths did this before and now warns
    // that it is redundant.
    resolve: { tsconfigPaths: true },
});
