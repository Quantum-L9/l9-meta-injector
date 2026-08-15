// Flat ESLint config satisfying the L9 lint job (`eslint .`) for a TypeScript
// consumer. Scoped to first-party source and tests; the TypeScript parser is
// supplied by `typescript-eslint`. Kept intentionally light for initial CI
// activation — the lint surface is established here and can be tightened later
// via governance quality-thresholds rather than blocking the first green run.
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "fixtures/**",
      "examples/**",
      "scripts/**",
      "**/*.js",
      "**/*.cjs",
      "**/*.mjs",
    ],
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2020, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
