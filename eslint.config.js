import js from "@eslint/js";
import globals from "globals";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
// This import is what pins the repo to TypeScript 5/6.
//
// typescript-eslint 8.66.0 (the newest release as of 2026-08-08) throws at
// module load on any TypeScript with a major >= 7 — an unconditional
// `if (versionMajor >= 7)` in its dist/index.js, not a suppressible warning.
// `bunx eslint .` exits 2 before evaluating this config at all.
//
// Verified with typescript@7.0.2 in a scratch clone: `bunx tsc --noEmit`
// exits 0, so the source tree itself is already TS 7 clean and TypeScript is
// not the blocker — lint is. Upstream tracks TS >= 7.1 support in
// typescript-eslint#10940; their interim suggestion is running the linter
// against the TS 6 API side by side.
//
// Re-test by bumping typescript in a throwaway clone and running the two
// commands above. Do not bump typescript here until that lint run passes.
import tseslint from "typescript-eslint";
import { createRequire } from "node:module";

// Read from the installed react, not "detect" and not a literal.
//
// "detect" makes eslint-plugin-react 7.37.5 resolve the version through a
// helper that calls context.getFilename(), which ESLint 10 removed, so every
// run dies with "contextOrFilename.getFilename is not a function" before a
// single rule reports. Reading package.json directly reaches the same answer
// without touching that code path.
//
// Not a hard-coded string either: react is on a caret range, so a literal
// would silently freeze the version-gated rules (react/no-deprecated and
// friends) at whatever was current when someone typed it.
//
// Revert to "detect" once eslint-plugin-react supports ESLint 10.
const require = createRequire(import.meta.url);
const REACT_VERSION = require("react/package.json").version;

export default [
    {
        ignores: [
            "build/**",
            "node_modules/**",
            "public/**",
            "app/routes/+types/**",
            ".react-router/**",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    react.configs.flat.recommended,
    // Required alongside recommended: it turns off react-in-jsx-scope and
    // jsx-uses-react, which the automatic JSX runtime makes wrong.
    react.configs.flat["jsx-runtime"],
    // react/prop-types stays on and stays quiet: eslint-plugin-react accepts
    // TypeScript prop annotations as validation, so the typed components here
    // satisfy it. `bunx eslint .` reports zero messages.
    jsxA11y.flatConfigs.recommended,
    // Needs to be in scope for the recommended config above, not only for the
    // TypeScript block below, or eslint-plugin-react warns on every run.
    { settings: { react: { version: REACT_VERSION } } },
    {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        plugins: {
            "react-hooks": reactHooks,
        },
        settings: {
            react: {
                version: REACT_VERSION,
            },
        },
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                },
            ],
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",
        },
    },
];
