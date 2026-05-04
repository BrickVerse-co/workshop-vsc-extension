import * as vscode from "vscode";

interface BrickVerseProjectConfig {
	name: string;
	engineVersion: string;
	api?: string;
	universeId: string;
	worldId: string;
}

export async function createProjectConfig(
	_context: vscode.ExtensionContext,
): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];

	if (!folder) {
		vscode.window.showErrorMessage("Open a workspace folder first.");
		return;
	}

	const configUri = vscode.Uri.joinPath(folder.uri, "brickverse.project.json");

	try {
		const universeId = (
			await vscode.window.showInputBox({
				prompt: "Universe ID (required)",
				placeHolder: "e.g. 123456",
				validateInput: (value) =>
					value.trim().length === 0 ? "Universe ID is required." : undefined,
				ignoreFocusOut: true,
			})
		)?.trim();

		if (!universeId) {
			vscode.window.showWarningMessage(
				"Project config creation cancelled: Universe ID is required.",
			);
			return;
		}

		const worldId = (
			await vscode.window.showInputBox({
				prompt: "World ID (required)",
				placeHolder: "e.g. 987654",
				validateInput: (value) =>
					value.trim().length === 0 ? "World ID is required." : undefined,
				ignoreFocusOut: true,
			})
		)?.trim();

		if (!worldId) {
			vscode.window.showWarningMessage(
				"Project config creation cancelled: World ID is required.",
			);
			return;
		}

		const config: BrickVerseProjectConfig = {
			name: folder.name,
			engineVersion: "0.1.0",
			universeId,
			worldId,
		};

		await vscode.workspace.fs.writeFile(
			configUri,
			Buffer.from(JSON.stringify(config, null, 2)),
		);

		const doc = await vscode.workspace.openTextDocument(configUri);
		await vscode.window.showTextDocument(doc);

		vscode.window.showInformationMessage(
			"Created brickverse.project.json (using built-in default API).",
		);
	} catch (error) {
		vscode.window.showErrorMessage(
			`Failed to create BrickVerse project config: ${String(error)}`,
		);
	}
}
