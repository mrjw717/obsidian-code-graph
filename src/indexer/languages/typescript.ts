import type { Tree, Node as SyntaxNode } from 'web-tree-sitter';
import type {
	SymbolDef,
	SymbolRef,
	InheritRef,
	ImplementsRef,
	SymbolExtract,
} from '../extractor';

/** Built-in / library types that should not produce uses-type edges. */
const BUILTIN_TYPES = new Set([
	'string', 'number', 'boolean', 'void', 'null', 'undefined', 'any', 'unknown',
	'object', 'symbol', 'bigint', 'never', 'object',
	'String', 'Number', 'Boolean', 'Object', 'Array', 'Map', 'Set', 'Promise',
	'Date', 'RegExp', 'Error', 'TypeError', 'Record', 'Partial', 'Readonly',
	'ReadonlyArray', 'ReadonlyMap', 'ReadonlySet', 'Pick', 'Omit', 'Required',
	'Record', 'Exclude', 'Extract', 'NonNullable', 'Parameters', 'ReturnType',
	'InstanceType', 'ThisType', 'HTMLElement', 'HTMLButtonElement', 'HTMLSpanElement',
	'HTMLDivElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent',
	'Node', 'Element', 'Document', 'Window', 'ReactNode', 'ReactElement',
	'FC', 'Component', 'ComponentType', 'Ref', 'MutableRefObject',
	'ButtonHTMLAttributes', 'HTMLAttributes', 'InputHTMLAttributes',
	'CSSProperties', 'PropsWithChildren', 'PropsWithRef',
]);

function baseNameOf(node: SyntaxNode): string {
	// For "Foo", "Foo<Bar>", "Foo.Bar" -> the head identifier segment.
	return (node.text.split(/[<.]/)[0] ?? '').trim();
}

function addCallRef(node: SyntaxNode, out: SymbolRef[]): void {
	let name = '';
	if (node.type === 'identifier' || node.type === 'type_identifier') {
		name = node.text;
	} else if (node.type === 'member_expression') {
		name = node.childForFieldName('property')?.text ?? '';
	}
	if (name) {
		out.push({ name, line: node.startPosition.row + 1 });
	}
}

/** Extract base-type names from an extends_clause / implements_clause. */
function extractHeritageTypes(clause: SyntaxNode): { name: string; line: number }[] {
	const out: { name: string; line: number }[] = [];
	for (const arg of clause.namedChildren) {
		// Skip type argument lists (generics) and annotations — only the
		// head type identifier matters for cross-file resolution.
		const baseName = baseNameOf(arg);
		if (baseName && baseName.length > 0) {
			out.push({ name: baseName, line: arg.startPosition.row + 1 });
		}
	}
	return out;
}

/** Tree-sitter extractor for JavaScript & TypeScript (incl. tsx/jsx). */
export function extractTypeScript(tree: Tree): SymbolExtract {
	const defines: SymbolDef[] = [];
	const references: SymbolRef[] = [];
	const inherits: InheritRef[] = [];
	const implementsRefs: ImplementsRef[] = [];
	const typeRefs: SymbolRef[] = [];

	// scope tracks the chain of containing class/interface names so methods
	// get a containerName for unique node IDs (e.g. "Calculator.render").
	const visit = (node: SyntaxNode, scope: string[]): void => {
		switch (node.type) {
			case 'function_declaration': {
				const name = node.childForFieldName('name')?.text;
				if (name) {
					defines.push({
						name,
						kind: 'function',
						line: node.startPosition.row + 1,
						endLine: node.endPosition.row + 1,
						containerName: scope.length > 0 ? scope[scope.length - 1] : undefined,
					});
				}
				break;
			}
			case 'class_declaration': {
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
				visitHeritage(node, inherits, implementsRefs);
				// Visit children (methods) with the class name in scope.
				for (const child of node.namedChildren) visit(child, newScope);
				return; // already visited children — don't fall through
			}
			case 'interface_declaration': {
				const name = node.childForFieldName('name')?.text;
				const newScope = name ? [...scope, name] : scope;
				if (name) {
					defines.push({
						name,
						kind: 'interface',
						line: node.startPosition.row + 1,
						endLine: node.endPosition.row + 1,
					});
				}
				// Interfaces use "extends" for inheritance (no "implements").
				visitHeritage(node, inherits, implementsRefs);
				for (const child of node.namedChildren) visit(child, newScope);
				return;
			}
			case 'type_alias_declaration': {
				const name = node.childForFieldName('name')?.text;
				if (name) {
					defines.push({
						name,
						kind: 'type',
						line: node.startPosition.row + 1,
						endLine: node.endPosition.row + 1,
					});
				}
				break;
			}
			case 'enum_declaration': {
				const name = node.childForFieldName('name')?.text;
				if (name) {
					defines.push({
						name,
						kind: 'enum',
						line: node.startPosition.row + 1,
						endLine: node.endPosition.row + 1,
					});
				}
				break;
			}
			case 'method_definition': {
				const name = node.childForFieldName('name')?.text;
				if (name && name !== 'constructor') {
					defines.push({
						name,
						kind: 'method',
						line: node.startPosition.row + 1,
						endLine: node.endPosition.row + 1,
						containerName: scope.length > 0 ? scope[scope.length - 1] : undefined,
					});
				}
				break;
			}
			case 'variable_declarator': {
				const name = node.childForFieldName('name')?.text;
				const value = node.childForFieldName('value');
				if (
					name &&
					value &&
					(value.type === 'arrow_function' ||
						value.type === 'function_expression')
				) {
					defines.push({
						name,
						kind: 'variable',
						line: node.startPosition.row + 1,
						endLine: node.endPosition.row + 1,
					});
				}
				break;
			}
			case 'call_expression': {
				const fn = node.childForFieldName('function');
				if (fn) addCallRef(fn, references);
				break;
			}
			case 'new_expression': {
				const ctor = node.childForFieldName('constructor');
				if (ctor) addCallRef(ctor, references);
				break;
			}
			// JSX component usage: <Calculator /> or <Foo.Bar>...</Foo.Bar>.
			// Treats a PascalCase component reference as a call to its
			// definition, so e.g. `page.tsx` gets a `calls` edge to
			// `Calculator.tsx`. Lowercase intrinsics (<div>, <span>) are
			// skipped via the `/^[A-Z]/` guard.
			case 'jsx_self_closing_element':
			case 'jsx_opening_element': {
				const nameNode = node.childForFieldName('name');
				if (nameNode) {
					const last = nameNode.text.split(/[.]/).pop();
					if (last && /^[A-Z]/.test(last)) {
						references.push({
							name: last,
							line: node.startPosition.row + 1,
						});
					}
				}
				break;
			}
			// Type annotations: `const x: Foo = ...`, `function f(x: Bar): Baz`
			// Extract type_identifier children as uses-type references.
			case 'type_annotation': {
				const collectTypeIds = (n: SyntaxNode): void => {
					if (
						n.type === 'type_identifier' &&
						!BUILTIN_TYPES.has(n.text)
					) {
						typeRefs.push({
							name: n.text,
							line: n.startPosition.row + 1,
						});
					}
					for (const c of n.namedChildren) collectTypeIds(c);
				};
				collectTypeIds(node);
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

/**
 * Walk a class/interface node's heritage clauses, routing extends → inherits
 * and implements → implements. Handles both direct children and the
 * `class_heritage` wrapper node (present in some grammar versions).
 */
function visitHeritage(
	node: SyntaxNode,
	inherits: InheritRef[],
	implementsRefs: ImplementsRef[],
): void {
	const clauses: SyntaxNode[] = [];
	for (const c of node.namedChildren) {
		if (
			c.type === 'extends_clause' ||
			c.type === 'implements_clause'
		) {
			clauses.push(c);
		} else if (c.type === 'class_heritage') {
			for (const hc of c.namedChildren) {
				if (
					hc.type === 'extends_clause' ||
					hc.type === 'implements_clause'
				) {
					clauses.push(hc);
				}
			}
		}
	}
	for (const clause of clauses) {
		const types = extractHeritageTypes(clause);
		if (clause.type === 'implements_clause') {
			for (const t of types) {
				implementsRefs.push({ ifaceName: t.name, line: t.line });
			}
		} else {
			// extends_clause
			for (const t of types) {
				inherits.push({ baseName: t.name, line: t.line });
			}
		}
	}
}
