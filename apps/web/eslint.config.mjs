import nextPlugin from "@next/eslint-plugin-next";
import { createConfig } from "@pcos/config/eslint";

export default [
  ...createConfig({ react: true, node: false, ignores: [".next/**", "public/**", "next-env.d.ts"] }),
  {
    plugins: { "@next/next": nextPlugin },
    rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs["core-web-vitals"].rules },
  },
];
