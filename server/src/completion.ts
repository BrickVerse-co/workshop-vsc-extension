import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
	CompletionItem,
	CompletionItemKind,
	InsertTextFormat,
	type Position,
	TextEdit,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";

import { BrickLuaApiDefinition } from "./types";
import { apiEntryToCompletion, getApiEntries } from "./engineApi";

const SCRIPT_EXTENSIONS = new Set([".bricklua", ".blua", ".lua"]);
const IGNORE_DIRS = new Set([
	".git",
	".vscode",
	".brickverse",
	"node_modules",
	"out",
	"server",
]);

export async function buildCompletionItems(
	document: TextDocument,
	position: Position,
	projectApi?: BrickLuaApiDefinition,
	defaultEngineApi?: BrickLuaApiDefinition,
	defaultLuaApi?: BrickLuaApiDefinition,
	workspaceRoot?: string,
): Promise<CompletionItem[]> {
	const linePrefix = getLinePrefix(document, position);
	const requireContext = getRequireContext(linePrefix);
	const requireObjectContext = getRequireObjectContext(linePrefix);

	if (requireContext) {
		const requireRoot =
			workspaceRoot ?? path.dirname(uriToFsPath(document.uri));
		return buildRequirePathCompletions(
			document,
			position,
			requireRoot,
			requireContext.prefix,
			requireContext.startCharacter,
		);
	}

	if (requireObjectContext) {
		return buildRequireObjectCompletions(
			requireObjectContext.prefix,
			projectApi,
			defaultEngineApi,
		);
	}

	const projectEntries = getApiEntries(projectApi);
	const engineEntries = getApiEntries(defaultEngineApi);
	const luaEntries = getApiEntries(defaultLuaApi);

	if (isTypeAnnotationContext(linePrefix)) {
		return dedupeCompletions([
			...toTypeCompletions(projectEntries),
			...toTypeCompletions(engineEntries),
			...toTypeCompletions(luaEntries),
			...builtinTypeCompletions(),
		]);
	}

	return dedupeCompletions([
		...projectEntries.map(apiEntryToCompletion),
		...engineEntries.map(apiEntryToCompletion),
		...luaEntries.map(apiEntryToCompletion),
	]);
}

function toTypeCompletions(
	entries: ReturnType<typeof getApiEntries>,
): CompletionItem[] {
	return entries
		.filter(
			(entry) =>
				entry.kind === "class" ||
				entry.kind === "struct" ||
				entry.kind === "service" ||
				entry.kind === "type",
		)
		.map(apiEntryToCompletion);
}

function builtinTypeCompletions(): CompletionItem[] {
	const builtin = [
		"any",
		"unknown",
		"never",
		"void",
		"string",
		"number",
		"boolean",
		"nil",
		"table",
		"thread",
		"function",
	];

	return builtin.map((name) => ({
		label: name,
		kind: CompletionItemKind.TypeParameter,
		detail: "Built-in type",
	}));
}

function getLinePrefix(document: TextDocument, position: Position): string {
	const line = document.getText({
		start: { line: position.line, character: 0 },
		end: { line: position.line, character: position.character },
	});
	return line;
}

function isTypeAnnotationContext(linePrefix: string): boolean {
	if (/:\s*[A-Za-z_][A-Za-z0-9_\.]*$/.test(linePrefix)) return true;
	if (/:\s*$/.test(linePrefix)) return true;
	if (
		/\btype\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*[A-Za-z_0-9\.]*$/.test(linePrefix)
	) {
		return true;
	}

	return false;
}

function getRequireContext(
	linePrefix: string,
): { prefix: string; startCharacter: number } | null {
	const match = linePrefix.match(/require\s*\(\s*["']([^"']*)$/);
	if (!match) return null;

	const prefix = match[1] ?? "";
	const startCharacter = linePrefix.length - prefix.length;

	return { prefix, startCharacter };
}

function getRequireObjectContext(
	linePrefix: string,
): { prefix: string } | null {
	const match = linePrefix.match(/require\s*\(\s*([A-Za-z_][A-Za-z0-9_\.]*)$/);
	if (!match) return null;

	return { prefix: match[1] ?? "" };
}

async function buildRequirePathCompletions(
	document: TextDocument,
	position: Position,
	workspaceRoot: string,
	prefix: string,
	startCharacter: number,
): Promise<CompletionItem[]> {
	const filePath = uriToFsPath(document.uri);
	const fileDir = path.dirname(filePath);
	const scriptFiles = await collectScriptFiles(workspaceRoot);

	const completions = new Map<string, CompletionItem>();

	for (const scriptFile of scriptFiles) {
		const relativeFromCurrent = toPosixPath(path.relative(fileDir, scriptFile));
		const relativeWithoutExt = removeScriptExtension(relativeFromCurrent);
		const modulePath =
			prefix.startsWith(".") || prefix.startsWith("/")
				? ensureRelativePath(relativeWithoutExt)
				: toPosixPath(
						removeScriptExtension(path.relative(workspaceRoot, scriptFile)),
					);

		if (!modulePath || !modulePath.startsWith(prefix)) continue;

		completions.set(
			modulePath,
			makeRequireCompletion(modulePath, position, startCharacter),
		);

		const folderAlias = getFolderAlias(modulePath);
		if (folderAlias && folderAlias.startsWith(prefix)) {
			completions.set(
				folderAlias,
				makeRequireCompletion(folderAlias, position, startCharacter),
			);
		}
	}

	return [...completions.values()].slice(0, 200);
}

function makeRequireCompletion(
	modulePath: string,
	position: Position,
	startCharacter: number,
): CompletionItem {
	return {
		label: modulePath,
		kind: CompletionItemKind.File,
		detail: "require() path",
		insertTextFormat: InsertTextFormat.PlainText,
		textEdit: TextEdit.replace(
			{
				start: { line: position.line, character: startCharacter },
				end: position,
			},
			modulePath,
		),
	};
}

async function collectScriptFiles(root: string): Promise<string[]> {
	const output: string[] = [];

	async function visit(dir: string): Promise<void> {
		const entries = await fs.readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.name.startsWith(".")) {
				if (
					entry.name !== "." &&
					entry.name !== ".." &&
					entry.name !== ".brickverse"
				) {
					continue;
				}
			}

			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				if (IGNORE_DIRS.has(entry.name)) continue;
				await visit(fullPath);
				continue;
			}

			if (!entry.isFile()) continue;

			if (SCRIPT_EXTENSIONS.has(path.extname(entry.name))) {
				output.push(fullPath);
			}
		}
	}

	await visit(root);
	return output;
}

function dedupeCompletions(items: CompletionItem[]): CompletionItem[] {
	const unique = new Map<string, CompletionItem>();
	for (const item of items) {
		if (!unique.has(item.label)) {
			unique.set(item.label, item);
		}
	}
	return [...unique.values()];
}

function buildRequireObjectCompletions(
	prefix: string,
	projectApi?: BrickLuaApiDefinition,
	defaultEngineApi?: BrickLuaApiDefinition,
): CompletionItem[] {
	const suggestions = new Map<string, CompletionItem>();

	const fixedSuggestions = [
		"script",
		"script.Parent",
		"script.Parent.Parent",
		"game",
		"game.ReplicatedStorage",
		"game.ServerScriptService",
		"game.Players",
	];

	for (const label of fixedSuggestions) {
		if (!label.startsWith(prefix)) continue;
		suggestions.set(label, {
			label,
			kind: CompletionItemKind.Module,
			detail: "require() object path",
		});
	}

	for (const entry of [
		...getApiEntries(projectApi),
		...getApiEntries(defaultEngineApi),
	]) {
		if (entry.kind !== "service") continue;
		if (!entry.name.startsWith(prefix)) continue;
		if (suggestions.has(entry.name)) continue;

		suggestions.set(entry.name, {
			label: entry.name,
			kind: CompletionItemKind.Module,
			detail: "Engine service path",
		});
	}

	return [...suggestions.values()];
}

function removeScriptExtension(value: string): string {
	return value.replace(/\.(bricklua|blua|lua)$/i, "");
}

function ensureRelativePath(value: string): string {
	if (value.startsWith("../") || value.startsWith("./")) return value;
	return `./${value}`;
}

function getFolderAlias(modulePath: string): string | null {
	if (modulePath.endsWith("/init") || modulePath.endsWith("/index")) {
		return modulePath.replace(/\/(init|index)$/i, "");
	}

	return null;
}

function toPosixPath(value: string): string {
	return value.split(path.sep).join("/");
}

function uriToFsPath(uri: string): string {
	const url = new URL(uri);
	let filePath = decodeURIComponent(url.pathname);
	if (/^\/[A-Za-z]:\//.test(filePath)) {
		filePath = filePath.slice(1);
	}
	return filePath;
}
