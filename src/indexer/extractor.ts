/**
 * Per-file extraction result. Extractors produce raw, unresolved references;
 * the indexer/resolver turns these into file-level and symbol-level edges.
 */

export type SymbolKind =
	| 'function'
	| 'class'
	| 'method'
	| 'interface'
	| 'variable'
	| 'type'
	| 'enum'
	| 'constant';

export interface SymbolDef {
	name: string; // simple name (for reference matching, e.g. "render")
	kind: SymbolKind;
	line: number; // definition start line (1-based)
	endLine?: number; // definition end line (1-based); enables span-based containment
	containerName?: string; // parent class/interface name (for methods), e.g. "Calculator"
}

export interface SymbolRef {
	name: string;
	line: number;
}

export interface InheritRef {
	baseName: string;
	line: number;
}

export interface ImplementsRef {
	ifaceName: string;
	line: number;
}

export interface ImportSpec {
	specifier: string; // raw module path as written ("./foo", "../bar", "react")
	names: string[]; // imported local names, when extractable
	line: number;
}

export interface ExtractResult {
	imports: ImportSpec[];
	defines: SymbolDef[];
	references: SymbolRef[];
	inherits: InheritRef[];
}

/** What a tree-sitter extractor returns (imports are handled separately by regex). */
export interface SymbolExtract {
	defines: SymbolDef[];
	references: SymbolRef[];
	inherits: InheritRef[];
	implements: ImplementsRef[];
	typeRefs: SymbolRef[];
}
