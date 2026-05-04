import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";

import { type ValidationOptions } from "./types";

function validateKnownTypeAnnotations(
	text: string,
	diagnostics: Diagnostic[],
	knownTypes: string[],
) {
	const builtinTypes = new Set([
		"string",
		"number",
		"boolean",
		"nil",
		"void",
		"any",
		"unknown",
		"never",
		"table",
		"thread",
		"function",
	]);

	const allowedTypes = new Set([...builtinTypes, ...knownTypes]);

	const lines = text.split(/\r?\n/);
	const typePattern = /:\s*([A-Za-z_][A-Za-z0-9_]*)/g;

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const rawLine = lines[lineIndex];
		const line = stripLineComment(rawLine);

		for (const match of line.matchAll(typePattern)) {
			const typeName = match[1];

			if (!allowedTypes.has(typeName)) {
				const start = match.index ?? 0;
				const typeStart = start + match[0].indexOf(typeName);

				diagnostics.push({
					severity: DiagnosticSeverity.Warning,
					range: {
						start: { line: lineIndex, character: typeStart },
						end: { line: lineIndex, character: typeStart + typeName.length },
					},
					message: `Unknown BrickLua type '${typeName}'. Add it to .brickverse/api.json or check the spelling.`,
					source: "BrickLua",
				});
			}
		}
	}
}

export function validateBrickLuaText(
	text: string,
	options: ValidationOptions = {},
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];

	validateBalancedBlocks(text, diagnostics);
	validateBasicTypes(text, diagnostics);
	validateKnownTypeAnnotations(text, diagnostics, options.knownTypes ?? []);

	return diagnostics;
}

function validateBalancedBlocks(text: string, diagnostics: Diagnostic[]) {
	const lines = text.split(/\r?\n/);
	const stack: { keyword: string; line: number; character: number }[] = [];

	const openerPattern = /\b(function|if|do|for|while|repeat)\b/g;
	const closerPattern = /\b(end|until)\b/g;

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = stripLineComment(lines[lineIndex]);

		for (const match of line.matchAll(openerPattern)) {
			stack.push({
				keyword: match[1],
				line: lineIndex,
				character: match.index ?? 0,
			});
		}

		for (const match of line.matchAll(closerPattern)) {
			const closer = match[1];

			if (closer === "end") {
				const last = stack.pop();

				if (!last) {
					diagnostics.push({
						severity: DiagnosticSeverity.Error,
						range: {
							start: { line: lineIndex, character: match.index ?? 0 },
							end: {
								line: lineIndex,
								character: (match.index ?? 0) + closer.length,
							},
						},
						message: "Unexpected 'end'. No matching block was found.",
						source: "BrickLua",
					});
				}
			}

			if (closer === "until") {
				const last = stack.pop();

				if (!last || last.keyword !== "repeat") {
					diagnostics.push({
						severity: DiagnosticSeverity.Error,
						range: {
							start: { line: lineIndex, character: match.index ?? 0 },
							end: {
								line: lineIndex,
								character: (match.index ?? 0) + closer.length,
							},
						},
						message: "Unexpected 'until'. Expected a matching 'repeat' block.",
						source: "BrickLua",
					});
				}
			}
		}
	}

	for (const item of stack) {
		diagnostics.push({
			severity: DiagnosticSeverity.Warning,
			range: {
				start: { line: item.line, character: item.character },
				end: {
					line: item.line,
					character: item.character + item.keyword.length,
				},
			},
			message: `Block opened with '${item.keyword}' is missing a closing '${item.keyword === "repeat" ? "until" : "end"}'.`,
			source: "BrickLua",
		});
	}
}

function validateBasicTypes(text: string, diagnostics: Diagnostic[]) {
	const lines = text.split(/\r?\n/);

	const assignmentPattern =
		/\blocal\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(string|number|boolean)\s*=\s*(.+)$/;

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const rawLine = lines[lineIndex];
		const line = stripLineComment(rawLine);
		const match = line.match(assignmentPattern);

		if (!match) continue;

		const [, name, expectedType, value] = match;
		const actualType = inferLiteralType(value.trim());

		if (actualType && actualType !== expectedType) {
			const startCharacter = rawLine.indexOf(value);

			diagnostics.push({
				severity: DiagnosticSeverity.Error,
				range: {
					start: { line: lineIndex, character: Math.max(startCharacter, 0) },
					end: { line: lineIndex, character: rawLine.length },
				},
				message: `Type mismatch: '${name}' is declared as '${expectedType}' but assigned '${actualType}'.`,
				source: "BrickLua",
			});
		}
	}
}

function inferLiteralType(
	value: string,
): "string" | "number" | "boolean" | null {
	if (/^["'].*["']$/.test(value)) return "string";
	if (/^\d+(\.\d+)?$/.test(value)) return "number";
	if (/^(true|false)$/.test(value)) return "boolean";
	return null;
}

function stripLineComment(line: string): string {
	const commentIndex = line.indexOf("--");
	if (commentIndex === -1) return line;
	return line.slice(0, commentIndex);
}
