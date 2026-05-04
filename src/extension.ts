// (c) 2026 Meta Games LLC. All rights reserved.

import * as vscode from "vscode";

import { LanguageClient } from "vscode-languageclient/node";
import { OpenIdManager } from "./auth/openIdManager";
import { createProjectConfig } from "./commands/createProjectConfig";
import { registerExtensionCommands } from "./commands/extensionCommands";
import { DiscordRpcManager } from "./discord/rpcManager";
import { createBrickLuaLanguageClient } from "./lsp/client";
import { BrickLuaToolsProvider } from "./panel/toolsView";
import { registerStatusBarItems } from "./ui/statusBar";
import {
	createWorkspaceConfigWatcher,
	sendWorkspaceConfig,
} from "./workspace/workspaceNotifications";

let client: LanguageClient | undefined;
let discordRpcManager: DiscordRpcManager | undefined;
let openIdManager: OpenIdManager | undefined;

export async function activate(context: vscode.ExtensionContext) {
	client = createBrickLuaLanguageClient(context);
	openIdManager = new OpenIdManager(context);
	discordRpcManager = new DiscordRpcManager(() => {
		const user = openIdManager?.getCurrentUser();
		if (!user) {
			return null;
		}

		return {
			displayName: user.displayName,
			username: user.username,
			headshotUrl: user.headshotUrl,
		};
	});

	context.subscriptions.push(discordRpcManager);
	context.subscriptions.push(openIdManager);

	registerExtensionCommands(
		context,
		() => client,
		() => discordRpcManager?.isRunning() ?? false,
		() => openIdManager?.getCurrentUser() ?? null,
		async () => {
			await openIdManager?.openAccountMenu();
		},
	);

	const toolsProvider = new BrickLuaToolsProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider("brickluaTools", toolsProvider),
	);

	registerStatusBarItems(context);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"bricklua.createProjectConfig",
			async () => {
				await createProjectConfig(context);
			},
		),
	);

	await client.start();

	await sendWorkspaceConfig(client);
	createWorkspaceConfigWatcher(client, context);

	await discordRpcManager.syncFromConfiguration();

	const projectWatcher = vscode.workspace.createFileSystemWatcher(
		"**/brickverse.project.json",
	);

	context.subscriptions.push(
		projectWatcher,
		projectWatcher.onDidCreate(async () => {
			await discordRpcManager?.syncFromConfiguration();
		}),
		projectWatcher.onDidChange(async () => {
			await discordRpcManager?.syncFromConfiguration();
		}),
		projectWatcher.onDidDelete(async () => {
			await discordRpcManager?.syncFromConfiguration();
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(async () => {
			await discordRpcManager?.syncFromConfiguration();
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async (event) => {
			if (event.affectsConfiguration("bricklua.discordRpc")) {
				await discordRpcManager?.syncFromConfiguration();
			}
		}),
	);
}

export async function deactivate(): Promise<void> {
	openIdManager?.dispose();
	openIdManager = undefined;

	await discordRpcManager?.shutdown();
	discordRpcManager = undefined;

	if (!client) return;
	await client.stop();
}
