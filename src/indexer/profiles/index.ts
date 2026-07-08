/**
 * Public barrel for the language profile registry.
 *
 * Import from here: `import { getProfile, EXTENSION_TO_LANG } from './profiles'`.
 */
export type { LanguageProfile, ResolveContext } from './types';
export {
	PROFILES,
	getProfile,
	EXTENSION_TO_LANG,
	LANG_TO_GRAMMAR,
	TREE_SITTER_LANGS,
} from './registry';
