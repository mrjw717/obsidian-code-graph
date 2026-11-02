import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ Plugin: class {}, TFile: class {}, TAbstractFile: class {}, WorkspaceLeaf: class {}, Notice: class {} }));
vi.mock('../src/ui/GraphView', () => ({ CodeGraphView: class {} }));
vi.mock('../src/settings', () => ({ CodeGraphSettingTab: class {}, CURRENT_SETTINGS_VERSION: 10, DEFAULT_SETTINGS: { excludeFolders: ['default'], codeExtensions: ['ts'], edgeTypesEnabled: { calls: true } } }));
vi.mock('../src/commands/seedDomains', () => ({ registerSeedDomainsCommand: vi.fn() }));
import CodeGraphPlugin from '../src/main';

interface TestPlugin {
 reindex: ReturnType<typeof vi.fn>; rebuildModel: ReturnType<typeof vi.fn>;
 scheduleReindex(): void; scheduleRemerge(): void; onunload(): void; loadSettings(): Promise<void>;
 loadData: ReturnType<typeof vi.fn>; saveData: ReturnType<typeof vi.fn>;
 settings: { excludeFolders: string[]; codeExtensions: string[]; edgeTypesEnabled: { calls: boolean } };
}

describe('plugin lifecycle regressions', () => {
	beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('window', globalThis); });
	it('does not replace a pending reindex with a metadata remerge', () => {
		const plugin = Object.assign(Object.create(CodeGraphPlugin.prototype), { reindexTimer: null, unloaded: false }) as TestPlugin;
		plugin.reindex = vi.fn(); plugin.rebuildModel = vi.fn();
		plugin.scheduleReindex(); plugin.scheduleRemerge();
		vi.advanceTimersByTime(700);
		expect(plugin.reindex).toHaveBeenCalledOnce();
		expect(plugin.rebuildModel).not.toHaveBeenCalled();
		vi.useRealTimers();
	});
	it('cancels the pending reindex on unload', () => {
		const plugin = Object.assign(Object.create(CodeGraphPlugin.prototype), { reindexTimer: null, unloaded: false }) as TestPlugin;
		plugin.reindex = vi.fn(); plugin.scheduleReindex(); plugin.onunload();
		vi.advanceTimersByTime(700);
		expect(plugin.reindex).not.toHaveBeenCalled();
		vi.useRealTimers();
	});
	it('preserves customized settings during migration', async () => {
		const plugin = Object.assign(Object.create(CodeGraphPlugin.prototype), { reindexTimer: null, unloaded: false }) as TestPlugin;
		plugin.loadData = vi.fn().mockResolvedValue({ settingsVersion: 9, excludeFolders: ['mine'], codeExtensions: ['custom'], edgeTypesEnabled: { calls: false } });
		plugin.saveData = vi.fn();
		await plugin.loadSettings();
		expect(plugin.settings.excludeFolders).toEqual(['mine']);
		expect(plugin.settings.codeExtensions).toEqual(['custom']);
		expect(plugin.settings.edgeTypesEnabled.calls).toBe(false);
	});
});
