import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import nextGuardrails from "./eslint-next-guardrails.mjs";

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      "iam-next-guardrails": nextGuardrails,
    },
    settings: {
      react: {
        // Explicit version avoids React auto-detection through removed ESLint 10 context APIs.
        version: "19.3.1",
      },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "iam-next-guardrails/no-img-element": "warn",
      "iam-next-guardrails/no-html-link-for-pages": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
