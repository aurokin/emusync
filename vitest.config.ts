import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Still the plugin here, not Vite 8's resolve.tsconfigPaths: vitest/config
// re-exports Vite 7 types, which do not know that option.
export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        environment: "jsdom",
        globals: true,
        include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
        silent: true,
    },
});
