import js from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      ".vercel/**",
      "config.js",
      "Photos/**",
      "Assets/**",
      "sanity/schemas/**",
    ],
  },
  js.configs.recommended,
  sonarjs.configs.recommended,
  {
    // Browser-loaded classic scripts. Loaded via <script src="..."> with no
    // type="module", so they share the global scope.
    files: ["script.js", "sanity-client.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        // Snipcart, Vercel analytics, Sanity client — all attached to window
        // by third-party / sibling scripts at runtime.
        Snipcart: "readonly",
        PNP_CONFIG: "readonly",
        PNP_SANITY: "readonly",
      },
    },
    rules: {
      // The carousel + header injections legitimately mutate global state.
      "no-undef": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Vercel serverless functions + Node build scripts — ESM, Node globals.
    files: ["api/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
