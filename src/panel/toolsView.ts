import * as vscode from "vscode";

interface ToolItemDef {
	label: string;
	description?: string;
	command: string;
	iconId: string;
}

class ToolItem extends vscode.TreeItem {
	constructor(def: ToolItemDef) {
		super(def.label, vscode.TreeItemCollapsibleState.None);
		this.description = def.description;
		this.command = {
			command: def.command,
			title: def.label,
		};
		this.iconPath = new vscode.ThemeIcon(def.iconId);
		this.contextValue = "brickluaToolItem";
	}
}

export class BrickLuaToolsProvider implements vscode.TreeDataProvider<ToolItem> {
	private readonly items: ToolItem[] = [
		new ToolItem({
			label: "Restart Language Server",
			description: "Reload BrickLua diagnostics and completions",
			command: "bricklua.restartServer",
			iconId: "debug-restart",
		}),
		new ToolItem({
			label: "Open BrickLua Settings",
			description: "Configure extension preferences",
			command: "bricklua.openSettings",
			iconId: "settings-gear",
		}),
		new ToolItem({
			label: "Toggle Discord RPC",
			description: "Enable or disable Rich Presence",
			command: "bricklua.toggleDiscordRpc",
			iconId: "broadcast",
		}),
		new ToolItem({
			label: "Account",
			description: "Sign in/out and view current user",
			command: "bricklua.openId.openAccountMenu",
			iconId: "account",
		}),
		new ToolItem({
			label: "Extension Info",
			description: "Show version and quick help",
			command: "bricklua.showInfo",
			iconId: "info",
		}),
	];

	getTreeItem(element: ToolItem): vscode.TreeItem {
		return element;
	}

	getChildren(): Thenable<ToolItem[]> {
		return Promise.resolve(this.items);
	}
}
