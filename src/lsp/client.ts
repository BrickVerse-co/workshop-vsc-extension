import * as path from "node:path";
import * as vscode from "vscode";

import {
	LanguageClient,
	type LanguageClientOptions,
	type ServerOptions,
	TransportKind,
} from "vscode-languageclient/node";

export function createBrickLuaLanguageClient(
	context: vscode.ExtensionContext,
): LanguageClient {
	const serverModule = context.asAbsolutePath(
		path.join("server", "out", "server.js"),
	);

	const serverOptions: ServerOptions = {
		run: {
			module: serverModule,
			transport: TransportKind.ipc,
		},
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: {
				execArgv: ["--nolazy", "--inspect=6009"],
			},
		},
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: "file", language: "bricklua" },
			{ scheme: "untitled", language: "bricklua" },
			{ scheme: "file", language: "lua" },
			{ scheme: "untitled", language: "lua" },
		],
		synchronize: {
			fileEvents: [
				vscode.workspace.createFileSystemWatcher("**/*.{bricklua,blua}"),
				vscode.workspace.createFileSystemWatcher("**/brickverse.project.json"),
				vscode.workspace.createFileSystemWatcher("**/.brickverse/**/*.json"),
			],
		},
	};

	return new LanguageClient(
		"brickluaLanguageServer",
		"BrickLua Language Server",
		serverOptions,
		clientOptions,
	);
}
