import { TextFileView, WorkspaceLeaf } from 'obsidian';

export const VIEW_TYPE_CODE_TEXT = 'code-graph-text-view';

/**
 * Fallback plaintext editor for code extensions that no other plugin handles.
 * Fills the gap so clicking a node always opens the file inside Obsidian rather
 * than the OS opener. If vscode-editor (or any plugin) already registers an
 * extension, that view wins and this one is never used for it.
 */
export class CodeTextView extends TextFileView {
	private textarea: HTMLTextAreaElement;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.contentEl.addClass('code-graph-text-view-container');
		this.textarea = this.contentEl.createEl('textarea', {
			cls: 'code-graph-text-editor',
		});
		this.textarea.spellcheck = false;
		this.textarea.setAttribute('autocomplete', 'off');
		this.textarea.setAttribute('autocapitalize', 'off');
		// Debounced save whenever the user edits.
		this.textarea.addEventListener('input', () => this.requestSave());
	}

	getViewType(): string {
		return VIEW_TYPE_CODE_TEXT;
	}

	getDisplayText(): string {
		return this.file?.name ?? 'Code';
	}

	getIcon(): string {
		return 'file-code';
	}

	getViewData(): string {
		return this.textarea.value;
	}

	setViewData(data: string, _clear: boolean): void {
		this.textarea.value = data;
	}

	clear(): void {
		this.textarea.value = '';
	}
}
