import * as vscode from "vscode";

import { LanguageClient } from "vscode-languageclient/node";

interface AuthUser {
	id: string;
	displayName: string;
	username?: string;
}

export function registerExtensionCommands(
	context: vscode.ExtensionContext,
	getClient: () => LanguageClient | undefined,
	getRpcRunning: () => boolean,
	getAuthUser: () => AuthUser | null,
	openAccountMenu: () => Promise<void>,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("bricklua.openControls", async () => {
			const authUser = getAuthUser();
			const options = [
				"Restart Language Server",
				"Create Project Config",
				"Open BrickLua Settings",
				getRpcRunning() ? "Disable Discord RPC" : "Enable Discord RPC",
				authUser
					? `Signed in: ${authUser.displayName}`
					: "Sign in to BrickVerse",
				"Extension Info",
			];

			const selected = await vscode.window.showQuickPick(options, {
				title: "BrickLua Controls",
				placeHolder: "Choose an action",
				ignoreFocusOut: true,
			});

			switch (selected) {
				case "Restart Language Server":
					await vscode.commands.executeCommand("bricklua.restartServer");
					break;
				case "Create Project Config":
					await vscode.commands.executeCommand("bricklua.createProjectConfig");
					break;
				case "Open BrickLua Settings":
					await vscode.commands.executeCommand("bricklua.openSettings");
					break;
				case "Enable Discord RPC":
				case "Disable Discord RPC":
					await vscode.commands.executeCommand("bricklua.toggleDiscordRpc");
					break;
				case "Sign in to BrickVerse":
					await vscode.commands.executeCommand("bricklua.openId.login");
					break;
				case `Signed in: ${authUser?.displayName}`:
					await vscode.commands.executeCommand(
						"bricklua.openId.openAccountMenu",
					);
					break;
				case "Extension Info":
					await vscode.commands.executeCommand("bricklua.showInfo");
					break;
				default:
					break;
			}
		}),
		vscode.commands.registerCommand("bricklua.restartServer", async () => {
			const client = getClient();
			if (!client) return;

			await client.stop();
			await client.start();

			vscode.window.showInformationMessage(
				"BrickLua language server restarted.",
			);
		}),
		vscode.commands.registerCommand("bricklua.openSettings", async () => {
			await vscode.commands.executeCommand(
				"workbench.action.openSettings",
				"@ext:MetaGames.workshop-bricklua bricklua",
			);
		}),
		vscode.commands.registerCommand("bricklua.toggleDiscordRpc", async () => {
			const config = vscode.workspace.getConfiguration("bricklua.discordRpc");
			const current = config.get<boolean>("enabled", false);
			await config.update(
				"enabled",
				!current,
				vscode.ConfigurationTarget.Global,
			);

			vscode.window.showInformationMessage(
				`BrickLua Discord RPC ${!current ? "enabled" : "disabled"}.`,
			);
		}),
		vscode.commands.registerCommand("bricklua.showInfo", async () => {
			const version = context.extension.packageJSON.version as string;
			await vscode.window.showInformationMessage(
				`BrickLua Extension v${version}\n\nBuilt-in Lua + Engine API docs are enabled by default.`,
				{ modal: true },
			);
		}),
		vscode.commands.registerCommand("bricklua.openId.login", async () => {
			await openAccountMenu();
		}),
		vscode.commands.registerCommand("bricklua.openId.logout", async () => {
			await openAccountMenu();
		}),
		vscode.commands.registerCommand(
			"bricklua.openId.openAccountMenu",
			async () => {
				await openAccountMenu();
			},
		),
	);
}
