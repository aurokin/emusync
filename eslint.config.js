import js from "@eslint/js";
import globals from "globals";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

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
    { settings: { react: { version: "detect" } } },
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
                version: "detect",
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
