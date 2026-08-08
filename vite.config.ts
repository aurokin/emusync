import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Test config lives in vitest.config.ts, which vitest prefers over this file.
// A `test` block here was silently ignored.
export default defineConfig({
    plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
});
