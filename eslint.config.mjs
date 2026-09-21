// The rules the Obsidian plugin review runs: eslint-plugin-obsidianmd's
// recommended set, which carries ESLint's and typescript-eslint's
// type-checked rules. `npm run lint` here is the review, locally.
//
// Five rules configured: four named as the review's record (below), and
// sentence case. Sentence case does not know this plugin's own names,
// and `brands` REPLACES the rule's default list, so Obsidian's are restated
// beside them. The review does not run this rule; the tree holds itself to
// it anyway (A418 step 2i).
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.*', 'esbuild.config.mjs'],
				},
			},
		},
		rules: {
			// THE RULES THE REVIEW REPORTED ON CURSOR-SMITH while its local lint was
			// clean (its 1.6.1: an `as HTMLElement | null` on a parentElement), and
			// the type-checked rules that bite a class split. Each fires from the
			// recommended set already; each is NAMED here as the record of what the
			// review runs, and each was seen to fire on a throwaway file with the
			// offending line before the tree was linted clean (A453, 2026-09-20).
			// A rule the review reports that this config does not name is added
			// the same way the same day.
			'@typescript-eslint/no-unnecessary-type-assertion': 'warn',
			'@typescript-eslint/no-misused-promises': 'error',
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-unsafe-declaration-merging': 'error',
			'obsidianmd/ui/sentence-case': ['warn', {
				enforceCamelCaseLower: true,
				brands: ['Obsidian', 'Obsidian Sync', 'Obsidian Publish', 'Word-Smith', 'Cursor-Smith', 'Organizer', 'Powerline', 'Powermenu', 'Vim', 'Times New Roman', 'Misc', 'Escape', 'Enter'],
			}],
		},
	},
	{
		ignores: ['main.js', 'node_modules/**'],
	},
]);
