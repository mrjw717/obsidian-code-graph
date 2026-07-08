import type { Tree, Node as SyntaxNode } from 'web-tree-sitter';
import type {
	SymbolDef,
	SymbolRef,
	InheritRef,
	ImplementsRef,
	SymbolExtract,
} from '../extractor';

/** Tree-sitter extractor for Python. */
export function extractPython(tree: Tree): SymbolExtract {
	const defines: SymbolDef[] = [];
	const references: SymbolRef[] = [];
	const inherits: InheritRef[] = [];
	const implementsRefs: ImplementsRef[] = []; // Python has no "implements"
	const typeRefs: SymbolRef[] = []; // TODO: Python type annotation extraction

	const visit = (node: SyntaxNode, scope: string[]): void => {
		switch (node.type) {
			case 'function_definition': {
				const name = node.childForFieldName('name')?.text;
				if (name) {
					const isMethod = scope.length > 0;
					defines.push({
						name,
						kind: isMethod ? 'method' : 'function',
						line: node.startPosition.row + 1,
						endLine: node.endPosition.row + 1,
						containerName: isMethod
							? scope[scope.length - 1]
							: undefined,
					});
				}
				break;
			}
			case 'class_definition': {
				const name = node.childForFieldName('name')?.text;
				const newScope = name ? [...scope, name] : scope;
				if (name) {
					defines.push({
						name,
						kind: 'class',
						line: node.startPosition.row + 1,
						endLine: node.endPosition.row + 1,
					});
				}
				const supers = node.childForFieldName('superclasses');
				if (supers) {
					for (const arg of supers.namedChildren) {
						const baseName = arg.text.split(/[.[]/)[0] ?? '';
						const trimmed = baseName.trim();
						if (trimmed) {
							inherits.push({
								baseName: trimmed,
								line: arg.startPosition.row + 1,
							});
						}
					}
				}
				// Visit body with class name in scope so methods get containerName.
				for (const child of node.namedChildren) visit(child, newScope);
				return; // already visited children
			}
			case 'call': {
				const fn = node.childForFieldName('function');
				if (fn) {
					let name = '';
					if (fn.type === 'identifier') {
						name = fn.text;
					} else if (fn.type === 'attribute') {
						name = fn.childForFieldName('attribute')?.text ?? '';
					}
					if (name) {
						references.push({
							name,
							line: node.startPosition.row + 1,
						});
					}
				}
				break;
			}
		}
		for (const child of node.namedChildren) visit(child, scope);
	};

	visit(tree.rootNode, []);
	return {
		defines,
		references,
		inherits,
		implements: implementsRefs,
		typeRefs,
	};
}
