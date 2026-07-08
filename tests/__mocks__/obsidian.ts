/**
 * Minimal mock of the 'obsidian' module for unit testing.
 * Only provides the symbols that seedDomains.ts imports at the top level.
 * The stampCodeHeader function (what we actually test) doesn't use any of
 * these — they're just needed so the module can be imported without the
 * Electron runtime.
 */

export class Modal {
	constructor() {}
	open(): void {}
	close(): void {}
}

export class Notice {
	constructor(_message: string, _timeout?: number) {}
}

export class TFile {
	path = '';
	basename = '';
	extension = '';
}

// Re-export commonly needed types as any for compatibility
export type App = unknown;
export type Plugin = unknown;