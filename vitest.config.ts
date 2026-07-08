import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		server: {
			deps: {
				// stub out 'obsidian' so modules importing from it can load
				// in the test environment without the Electron runtime.
				inline: [/^(?!obsidian$)/],
			},
		},
		alias: {
			obsidian: '/tests/__mocks__/obsidian.ts',
		},
	},
});