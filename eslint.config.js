import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "demo-dist/**",
      ".generated/**",
      "test-results/**",
      "playwright-report/**",
      ".package-check/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
);
