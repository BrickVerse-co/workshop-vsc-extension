import * as path from "node:path";
import * as net from "node:net";
import * as vscode from "vscode";

import {
	LanguageClient,
	type LanguageClientOptions,
	type ServerOptions,
	type StreamInfo,
	TransportKind,
} from "vscode-languageclient/node";

type ServerTransportMode = "socket" | "ipc";

function createSocketServerOptions(host: string, port: number): ServerOptions {
	const connect = (): Promise<StreamInfo> =>
		new Promise((resolve, reject) => {
			const socket = net.createConnection({ host, port }, () => {
				resolve({ reader: socket, writer: socket });
			});

			socket.once("error", (error) => {
				reject(error);
			});
		});

	return connect;
}

export function createBrickLuaLanguageClient(
	context: vscode.ExtensionContext,
): LanguageClient {
	const serverConfig = vscode.workspace.getConfiguration("bricklua.server");
	const transportMode = serverConfig.get<ServerTransportMode>(
		"transport",
		"socket",
	);
	const host = serverConfig.get<string>("host", "127.0.0.1");
	const port = serverConfig.get<number>("port", 9005);

	const serverModule = context.asAbsolutePath(
		path.join("server", "out", "server.js"),
	);

	const serverOptions: ServerOptions =
		transportMode === "socket"
			? createSocketServerOptions(host, port)
			: {
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
