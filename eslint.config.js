import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "dist-harness/**", "coverage/**", "node_modules/**", "eval/runs/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "MemberExpression[property.name='innerHTML']", message: "innerHTML yasak (text-only render)." },
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: "dangerouslySetInnerHTML yasak." },
        { selector: "CallExpression[callee.name='eval']", message: "eval yasak." },
        { selector: "NewExpression[callee.name='Function']", message: "new Function yasak." },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.mjs", "**/*.cjs", "scripts/**", "tests/e2e/**"],
    languageOptions: { globals: { process: "readonly", console: "readonly", require: "readonly", __dirname: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
