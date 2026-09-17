// The rules the Obsidian plugin review runs (eslint-plugin-obsidianmd's
// recommended set, which includes ESLint's and typescript-eslint's
// type-checked rules). `npm run lint` here is the review, locally. The
// no-unsafe-* family reports every `any` - the engine's per-caret working
// state is typed loosely on purpose (see plugin.ts) - so those are the bulk
// of what it prints; the review lists them as warnings.
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
  },
  {
    ignores: ["main.js", "build/**", "test/**", "esbuild.config.mjs"],
  },
]);
