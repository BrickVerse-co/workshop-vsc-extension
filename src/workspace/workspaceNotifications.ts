import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

export async function sendWorkspaceConfig(
	client: LanguageClient,
): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) return;

	await client.sendNotification("bricklua/workspaceChanged", {
		workspaceRoot: folder.uri.fsPath,
	});
}

export function createWorkspaceConfigWatcher(
	client: LanguageClient,
	context: vscode.ExtensionContext,
): void {
	const watcher = vscode.workspace.createFileSystemWatcher(
		"**/brickverse.project.json",
	);

	context.subscriptions.push(
		watcher.onDidCreate(() => sendWorkspaceConfig(client)),
		watcher.onDidChange(() => sendWorkspaceConfig(client)),
		watcher.onDidDelete(() => sendWorkspaceConfig(client)),
		watcher,
	);
}
