// Shared flat ESLint config for all workspaces.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * @param {{ react?: boolean, node?: boolean, ignores?: string[] }} [options]
 */
export function createConfig(options = {}) {
  const { react = false, node = true, ignores = [] } = options;
  return tseslint.config(
    {
      ignores: ["dist/**", ".next/**", "coverage/**", "node_modules/**", "drizzle/**", "*.config.*", ...ignores],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: "module",
        globals: {
          ...(node ? globals.node : {}),
          ...(react ? globals.browser : {}),
        },
      },
      rules: {
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
        "@typescript-eslint/no-explicit-any": "error",
        "no-console": "off",
        eqeqeq: ["error", "always", { null: "ignore" }],
        "prefer-const": "error",
      },
    },
    ...(react
      ? [
          {
            plugins: { "react-hooks": reactHooks },
            rules: {
              "react-hooks/rules-of-hooks": "error",
              "react-hooks/exhaustive-deps": "warn",
            },
          },
        ]
      : []),
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "**/test/**"],
      rules: {
        "@typescript-eslint/no-non-null-assertion": "off",
      },
    },
  );
}

export default createConfig();
