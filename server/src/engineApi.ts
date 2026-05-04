// (c) 2026 Meta Games LLC. All rights reserved.

import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
	CompletionItem,
	CompletionItemKind,
	MarkupKind,
	type Hover,
} from "vscode-languageserver/node";

import { BrickLuaApiDefinition, BrickLuaApiEntry } from "./types";

const ENGINE_API_RELATIVE_PATH = path.join(
	"resources",
	"default-engine-api.json",
);
const ENGINE_DOCS_RELATIVE_PATH = path.join(
	"resources",
	"default-engine-docs.json",
);
const LUA_API_RELATIVE_PATH = path.join("resources", "default-lua-api.json");

interface EngineApiDocsFile {
	globals?: Record<string, Partial<BrickLuaApiEntry>>;
	types?: Record<string, Partial<BrickLuaApiEntry>>;
	functions?: Record<string, Partial<BrickLuaApiEntry>>;
}

export async function loadDefaultEngineApi(): Promise<BrickLuaApiDefinition> {
	const apiPath = path.resolve(__dirname, "../..", ENGINE_API_RELATIVE_PATH);
	const raw = await fs.readFile(apiPath, "utf8");
	const api = JSON.parse(raw) as BrickLuaApiDefinition;

	const docsPath = path.resolve(__dirname, "../..", ENGINE_DOCS_RELATIVE_PATH);
	const docs = await readJsonIfExists<EngineApiDocsFile>(docsPath);

	if (!docs) {
		return api;
	}

	return applyDocsOverlay(api, docs);
}

export async function loadDefaultLuaApi(): Promise<BrickLuaApiDefinition> {
	const apiPath = path.resolve(__dirname, "../..", LUA_API_RELATIVE_PATH);
	const raw = await fs.readFile(apiPath, "utf8");
	return JSON.parse(raw) as BrickLuaApiDefinition;
}

export function getApiEntries(api?: BrickLuaApiDefinition): BrickLuaApiEntry[] {
	if (!api) return [];
	return [
		...(api.globals ?? []),
		...(api.types ?? []),
		...(api.functions ?? []),
		...(api.constants ?? []),
		...(api.keywords ?? []),
	];
}

export function collectKnownTypes(
	projectApi?: BrickLuaApiDefinition,
	defaultApi?: BrickLuaApiDefinition,
): string[] {
	const known = new Set<string>();

	for (const entry of [
		...getApiEntries(defaultApi),
		...getApiEntries(projectApi),
	]) {
		if (
			entry.kind === "class" ||
			entry.kind === "struct" ||
			entry.kind === "service" ||
			entry.kind === "type"
		) {
			known.add(entry.name);
		}
	}

	return [...known];
}

export function apiEntryToCompletion(entry: BrickLuaApiEntry): CompletionItem {
	return {
		label: entry.name,
		kind: getCompletionKind(entry.kind),
		detail: entry.signature ?? entry.type ?? entry.kind ?? "BrickLua API",
		documentation: entry.description ?? "",
	};
}

export function findApiEntryByName(
	name: string,
	projectApi?: BrickLuaApiDefinition,
	defaultApi?: BrickLuaApiDefinition,
): BrickLuaApiEntry | null {
	const allEntries = [
		...getApiEntries(projectApi),
		...getApiEntries(defaultApi),
	];

	const exact = allEntries.find((entry) => entry.name === name);
	if (exact) return exact;

	return (
		allEntries.find((entry) => {
			const segments = entry.name.split(".");
			return segments[segments.length - 1] === name;
		}) ?? null
	);
}

export function apiEntryToHover(entry: BrickLuaApiEntry): Hover {
	const lines: string[] = [];
	const declaration = formatDeclaration(entry);
	const callablePrototype = formatCallablePrototype(entry);

	lines.push(`## ${escapeMarkdown(entry.name)}`);
	lines.push("");
	lines.push(renderQuickFacts(entry));

	if (declaration) {
		lines.push("", "**Declaration**", "```lua", declaration, "```");
	}

	if (callablePrototype) {
		lines.push(
			"",
			"**Callable Prototype**",
			"```lua",
			callablePrototype,
			"```",
		);
	}

	if (entry.description) {
		lines.push("", "**Summary**", normalizeMultiline(entry.description));
	}

	if (entry.documentation) {
		lines.push("", "**Details**", normalizeMultiline(entry.documentation));
	}

	if (!entry.description && !entry.documentation) {
		lines.push(
			"",
			"No additional documentation is available for this engine symbol yet.",
		);
	}

	if (entry.parameters?.length) {
		lines.push("", "**Parameters**");
		lines.push("| Name | Type | Optional | Description |");
		lines.push("| --- | --- | --- | --- |");
		for (const parameter of entry.parameters) {
			lines.push(
				`| \`${escapeTable(parameter.name)}\` | \`${escapeTable(parameter.type)}\` | ${parameter.optional ? "Yes" : "No"} | ${escapeTable(parameter.description ?? "-")} |`,
			);
		}
	}

	if (entry.returns) {
		lines.push("", "**Returns**");
		lines.push("```lua", entry.returns.type, "```");
		if (entry.returns.description) {
			lines.push(normalizeMultiline(entry.returns.description));
		}
	}

	if (entry.examples?.length) {
		lines.push("", "**Examples**");
		for (const [index, example] of entry.examples.entries()) {
			if (entry.examples.length > 1) {
				lines.push("", `Example ${index + 1}:`);
			}
			lines.push("```lua", example, "```");
		}
	}

	lines.push("", "---", "BrickVerse API hover reference");

	return {
		contents: {
			kind: MarkupKind.Markdown,
			value: lines.join("\n"),
		},
	};
}

function formatDeclaration(entry: BrickLuaApiEntry): string {
	if (entry.signature) {
		return entry.signature;
	}

	if (entry.kind === "class") {
		return `class ${entry.name}`;
	}

	if (entry.kind === "struct") {
		return `struct ${entry.name}`;
	}

	if (entry.kind === "service" && entry.type) {
		return `${entry.name}: ${entry.type}`;
	}

	if (entry.type) {
		return `${entry.name}: ${entry.type}`;
	}

	return entry.name;
}

function formatMetaLine(entry: BrickLuaApiEntry): string {
	const parts = [
		entry.kind ? `Kind: \`${entry.kind}\`` : "",
		entry.type ? `Type: \`${entry.type}\`` : "",
	].filter(Boolean);

	if (!parts.length) {
		return "Built-in BrickLua API symbol.";
	}

	return parts.join("  •  ");
}

function renderQuickFacts(entry: BrickLuaApiEntry): string {
	const kind = entry.kind ? `\`${escapeTable(entry.kind)}\`` : "-";
	const type = entry.type ? `\`${escapeTable(entry.type)}\`` : "-";
	const signature = entry.signature
		? `\`${escapeTable(entry.signature)}\``
		: "-";

	return [
		"| Field | Value |",
		"| --- | --- |",
		`| Kind | ${kind} |`,
		`| Type | ${type} |`,
		`| Signature | ${signature} |`,
	].join("\n");
}

function formatCallablePrototype(entry: BrickLuaApiEntry): string | null {
	if (entry.kind !== "function" && entry.kind !== "method") {
		return null;
	}

	if (entry.signature) {
		return entry.signature;
	}

	if (!entry.parameters?.length) {
		return `${entry.name}()`;
	}

	const paramList = entry.parameters
		.map(
			(parameter) =>
				`${parameter.name}${parameter.optional ? "?" : ""}: ${parameter.type}`,
		)
		.join(", ");

	const returnPart = entry.returns?.type ? `: ${entry.returns.type}` : "";
	return `${entry.name}(${paramList})${returnPart}`;
}

function normalizeMultiline(value: string): string {
	return value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.join("\n");
}

function escapeMarkdown(value: string): string {
	return value.replace(/([*_`[\]{}()#+\-.!|])/g, "\\$1");
}

function escapeTable(value: string): string {
	return escapeMarkdown(value).replace(/\|/g, "\\|");
}

function getCompletionKind(kind?: string): CompletionItemKind {
	switch (kind) {
		case "class":
			return CompletionItemKind.Class;
		case "struct":
			return CompletionItemKind.Struct;
		case "service":
			return CompletionItemKind.Module;
		case "type":
			return CompletionItemKind.TypeParameter;
		case "function":
			return CompletionItemKind.Function;
		case "method":
			return CompletionItemKind.Method;
		case "property":
			return CompletionItemKind.Property;
		case "event":
			return CompletionItemKind.Event;
		case "keyword":
			return CompletionItemKind.Keyword;
		case "constant":
			return CompletionItemKind.Constant;
		default:
			return CompletionItemKind.Value;
	}
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		return JSON.parse(raw) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}

		throw error;
	}
}

function applyDocsOverlay(
	api: BrickLuaApiDefinition,
	docs: EngineApiDocsFile,
): BrickLuaApiDefinition {
	return {
		globals: mergeSection(api.globals, docs.globals),
		types: mergeSection(api.types, docs.types),
		functions: mergeSection(api.functions, docs.functions),
		keywords: api.keywords,
		constants: api.constants,
	};
}

function mergeSection(
	entries: BrickLuaApiEntry[] | undefined,
	docsByName: Record<string, Partial<BrickLuaApiEntry>> | undefined,
): BrickLuaApiEntry[] | undefined {
	if (!entries) return entries;

	if (!docsByName) {
		return entries;
	}

	return entries.map((entry) => ({
		...entry,
		...(docsByName[entry.name] ?? {}),
	}));
}
