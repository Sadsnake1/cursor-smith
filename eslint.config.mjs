// The rules the Obsidian plugin review runs (eslint-plugin-obsidianmd's
// recommended set, which includes ESLint's and typescript-eslint's
// type-checked rules). `npm run lint` here is the review, locally, and
// it is clean. The one rule configured: sentence case does not know Vim
// or CUA, which are proper nouns in this plugin's command names.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", { ignoreWords: ["Vim", "CUA"] }],
      // The review flags these and the recommended set here did not
      // (settings-tab.ts:241 in 1.6.0, an "as HTMLElement | null" on a
      // parentElement that already had that type): named here so the local
      // lint says so first.
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
    },
  },
  {
    ignores: ["main.js", "build/**", "test/**", "esbuild.config.mjs"],
  },
]);
