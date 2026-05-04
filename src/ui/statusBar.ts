import * as vscode from "vscode";

export function registerStatusBarItems(context: vscode.ExtensionContext): void {
	const item = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		100,
	);

	item.name = "BrickLua Controls";
	item.text = "$(symbol-key) BrickLua";
	item.tooltip = "Open BrickLua Controls";
	item.command = "bricklua.openControls";
	item.show();

	context.subscriptions.push(item);
}
