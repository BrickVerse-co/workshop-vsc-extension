// (c) 2026 Meta Games LLC. All rights reserved.

import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	InitializeParams,
	InitializeResult,
	TextDocumentSyncKind,
	CompletionItem,
	Hover,
	TextEdit,
	type Position,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import { validateBrickLuaText } from "./validation";
import { buildCompletionItems } from "./completion";

import {
	type BrickLuaApiDefinition,
	type LoadedBrickVerseProject,
} from "./types";
import { loadBrickVerseProject } from "./project";
import {
	apiEntryToHover,
	collectKnownTypes,
	findApiEntryByName,
	loadDefaultEngineApi,
	loadDefaultLuaApi,
} from "./engineApi";
import {createDocumentFormattingEdit} from "./formatting";

let currentProject: LoadedBrickVerseProject | null = null;
let defaultEngineApi: BrickLuaApiDefinition | null = null;
let defaultLuaApi: BrickLuaApiDefinition | null = null;

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((_params: InitializeParams): InitializeResult => {
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: [".", ":", "@", '"', "'", "/"],
			},
			hoverProvider: true,
			documentFormattingProvider: true,
		},
	};
});

connection.onInitialized(async () => {
	try {
		defaultEngineApi = await loadDefaultEngineApi();
		connection.console.info("Loaded shared default engine API.");
	} catch (error) {
		defaultEngineApi = null;
		connection.console.error(
			`Failed to load default engine API: ${String(error)}`,
		);
	}

	try {
		defaultLuaApi = await loadDefaultLuaApi();
		connection.console.info("Loaded shared default Lua API.");
	} catch (error) {
		defaultLuaApi = null;
		connection.console.error(
			`Failed to load default Lua API: ${String(error)}`,
		);
	}

	await revalidateAllOpenDocuments();
});

connection.onNotification(
	"bricklua/workspaceChanged",
	async (params: { workspaceRoot: string }) => {
		try {
			currentProject = await loadBrickVerseProject(params.workspaceRoot);

			connection.console.info(
				currentProject
					? `Loaded BrickVerse project: ${currentProject.config.name}${currentProject.world ? ` (World ${currentProject.world.name})` : ""}`
					: "No brickverse.project.json found.",
			);

			for (const document of documents.all()) {
				await validateDocument(document);
			}
		} catch (error) {
			currentProject = null;
			connection.console.error(
				`Failed to load BrickVerse project config: ${String(error)}`,
			);
		}
	},
);

connection.onCompletion(async (params): Promise<CompletionItem[]> => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return [];

	return buildCompletionItems(
		document,
		params.position,
		currentProject?.api,
		defaultEngineApi ?? undefined,
		defaultLuaApi ?? undefined,
		currentProject?.workspaceRoot,
	);
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	return item;
});

connection.onHover((params): Hover | null => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return null;

	const word = getWordAtPosition(document, params.position);

	if (!word) return null;

	const apiEntry = findApiEntryByName(
		word,
		currentProject?.api,
		mergeApiDefinitions(defaultLuaApi, defaultEngineApi),
	);
	if (!apiEntry) return null;

	return apiEntryToHover(apiEntry);
});

connection.onDocumentFormatting((params): TextEdit[] => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return [];

	return createDocumentFormattingEdit(document.getText(), params.options);
});

documents.onDidChangeContent((change) => {
	void validateDocument(change.document);
});

async function validateDocument(document: TextDocument): Promise<void> {
	const knownTypes = collectKnownTypes(
		currentProject?.api,
		mergeApiDefinitions(defaultLuaApi, defaultEngineApi),
	);

	connection.sendDiagnostics({
		uri: document.uri,
		diagnostics: validateBrickLuaText(document.getText(), { knownTypes }),
	});
}

function getWordAtPosition(
	document: TextDocument,
	position: Position,
): string | null {
	const textLine = document.getText({
		start: { line: position.line, character: 0 },
		end: { line: position.line, character: Number.MAX_SAFE_INTEGER },
	});

	const regex = /[A-Za-z_][A-Za-z0-9_]*/g;
	for (const match of textLine.matchAll(regex)) {
		const start = match.index ?? 0;
		const end = start + match[0].length;

		if (position.character >= start && position.character <= end) {
			return match[0];
		}
	}

	return null;
}

function mergeApiDefinitions(
	first: BrickLuaApiDefinition | null,
	second: BrickLuaApiDefinition | null,
): BrickLuaApiDefinition | undefined {
	if (!first && !second) return undefined;

	return {
		globals: [...(first?.globals ?? []), ...(second?.globals ?? [])],
		types: [...(first?.types ?? []), ...(second?.types ?? [])],
		functions: [...(first?.functions ?? []), ...(second?.functions ?? [])],
		constants: [...(first?.constants ?? []), ...(second?.constants ?? [])],
		keywords: [...(first?.keywords ?? []), ...(second?.keywords ?? [])],
	};
}

async function revalidateAllOpenDocuments(): Promise<void> {
	for (const document of documents.all()) {
		await validateDocument(document);
	}
}

documents.listen(connection);
connection.listen();
