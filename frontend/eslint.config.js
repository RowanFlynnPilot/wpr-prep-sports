// ESLint 9 flat config. The repo previously had no config at all, which
// made `npm run lint` a hard error under ESLint 9 — this restores it.
// Kept deliberately lean: parse errors, undefined globals, unused vars,
// and the React recommended set (minus rules that fight the Vite JSX
// runtime / prop-types-free style this codebase uses).
import js from "@eslint/js";
import react from "eslint-plugin-react";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: { react },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      "react/react-in-jsx-scope": "off", // Vite automatic JSX runtime
      "react/prop-types": "off", // codebase doesn't use prop-types
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.mjs", "vite.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
  },
];
