import * as vscode from "vscode";

interface BrickVerseProjectConfig {
	worldId?: string;
	universeId?: string;
}

interface RpcUserIdentity {
	displayName: string;
	username?: string;
	headshotUrl?: string;
}

interface DiscordRpcModule {
	Client: new (options: { transport: "ipc" }) => DiscordRpcClient;
	register(clientId: string): void;
}

interface DiscordRpcClient {
	on(event: "ready", listener: () => void): void;
	on(event: "disconnected", listener: () => void): void;
	on(event: "error", listener: (error: unknown) => void): void;
	login(options: { clientId: string }): Promise<void>;
	setActivity(activity: Record<string, unknown>): Promise<void>;
	destroy(): Promise<void>;
}

export class DiscordRpcManager implements vscode.Disposable {
	private client: DiscordRpcClient | null = null;
	private isReady = false;
	private isConnecting = false;
	private isDisposed = false;
	private currentApplicationId = "";
	private reconnectTimer: NodeJS.Timeout | null = null;
	private updateTimer: NodeJS.Timeout | null = null;
	private startTimestamp = Math.floor(Date.now() / 1000);
	private heartbeatTimer: NodeJS.Timeout | null = null;
	private shutdownPromise: Promise<void> | null = null;

	private readonly output = vscode.window.createOutputChannel("BrickLua RPC");
	private readonly subscriptions: vscode.Disposable[] = [];
	private readonly getCurrentUser?: () => RpcUserIdentity | null;

	constructor(getCurrentUser?: () => RpcUserIdentity | null) {
		this.getCurrentUser = getCurrentUser;
		this.output.appendLine("[RPC] DiscordRpcManager constructed.");

		this.subscriptions.push(
			vscode.window.onDidChangeActiveTextEditor(() => {
				this.output.appendLine("[RPC] Active editor changed.");
				this.queueActivityUpdate();
			}),
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				this.output.appendLine("[RPC] Workspace folders changed.");
				this.queueActivityUpdate();
			}),
			vscode.workspace.onDidSaveTextDocument(() => {
				this.output.appendLine("[RPC] Document saved.");
				this.queueActivityUpdate();
			}),
		);
	}

	async syncFromConfiguration(): Promise<void> {
		if (this.isDisposed) {
			return;
		}

		this.output.appendLine("[RPC] Syncing from configuration...");

		const hasBrickVerseProject = await this.hasBrickVerseProject();
		if (!hasBrickVerseProject) {
			this.output.appendLine(
				"[RPC] No brickverse.project.json found. RPC will remain disabled.",
			);
			await this.stop();
			return;
		}

		const config = vscode.workspace.getConfiguration("bricklua.discordRpc");
		const enabled = config.get<boolean>("enabled", false);
		const appId = config.get<string>("applicationId", "").trim();

		this.output.appendLine(`[RPC] Enabled: ${enabled}`);
		this.output.appendLine(`[RPC] Application ID set: ${Boolean(appId)}`);

		if (!enabled) {
			this.output.appendLine("[RPC] Disabled by configuration. Stopping.");
			await this.stop();
			return;
		}

		if (!appId) {
			this.output.appendLine("[RPC] No application ID configured.");
			vscode.window.showWarningMessage(
				"BrickLua Discord RPC is enabled, but no Discord application ID is configured.",
			);
			await this.stop();
			return;
		}

		if (this.currentApplicationId !== appId) {
			this.output.appendLine("[RPC] Application ID changed. Restarting RPC.");
			await this.stop();
			await this.start(appId);
			return;
		}

		if (!this.client && !this.isConnecting) {
			this.output.appendLine("[RPC] No client exists. Starting RPC.");
			await this.start(appId);
			return;
		}

		this.output.appendLine("[RPC] Client already exists. Updating activity.");
		this.queueActivityUpdate();
	}

	async stop(): Promise<void> {
		if (this.isDisposed) {
			return;
		}

		this.output.appendLine("[RPC] Stopping Discord RPC...");

		this.clearReconnectTimer();
		this.clearUpdateTimer();
		this.clearHeartbeatTimer();
		this.isConnecting = false;
		this.isReady = false;
		this.currentApplicationId = "";

		const oldClient = this.client;
		this.client = null;

		if (!oldClient) {
			this.output.appendLine("[RPC] No RPC client to destroy.");
			return;
		}

		try {
			await oldClient.destroy();
			this.output.appendLine("[RPC] RPC client destroyed.");
		} catch (error) {
			this.output.appendLine(
				`[RPC] Failed to destroy RPC client: ${String(error)}`,
			);
		}
	}

	dispose(): void {
		void this.shutdown();
	}

	async shutdown(): Promise<void> {
		if (this.shutdownPromise) {
			await this.shutdownPromise;
			return;
		}

		this.shutdownPromise = (async () => {
			if (this.isDisposed) {
				return;
			}

			this.output.appendLine("[RPC] Shutting down DiscordRpcManager.");
			this.isDisposed = true;

			vscode.Disposable.from(...this.subscriptions).dispose();
			this.clearReconnectTimer();
			this.clearUpdateTimer();
			this.clearHeartbeatTimer();

			this.isConnecting = false;
			this.isReady = false;
			this.currentApplicationId = "";

			const oldClient = this.client;
			this.client = null;

			if (oldClient) {
				try {
					await oldClient.destroy();
					this.output.appendLine("[RPC] RPC client destroyed during shutdown.");
				} catch (error) {
					this.output.appendLine(
						`[RPC] Failed to destroy RPC client during shutdown: ${String(error)}`,
					);
				}
			}

			this.output.dispose();
		})();

		await this.shutdownPromise;
	}

	isRunning(): boolean {
		return this.isReady;
	}

	private startHeartbeat(): void {
		this.clearHeartbeatTimer();
		this.output.appendLine("[RPC] Starting activity heartbeat.");

		this.heartbeatTimer = setInterval(() => {
			this.output.appendLine("[RPC] Heartbeat activity refresh.");
			void this.updateActivity();
		}, 15_000);
	}

	private clearHeartbeatTimer(): void {
		if (!this.heartbeatTimer) return;

		clearInterval(this.heartbeatTimer);
		this.heartbeatTimer = null;

		this.output.appendLine("[RPC] Cleared activity heartbeat.");
	}

	private async start(applicationId: string): Promise<void> {
		if (this.isDisposed) {
			return;
		}

		if (this.isConnecting) {
			this.output.appendLine("[RPC] Start skipped: already connecting.");
			return;
		}

		if (!(await this.hasBrickVerseProject())) {
			this.output.appendLine(
				"[RPC] Start skipped: no brickverse.project.json found.",
			);
			await this.stop();
			return;
		}

		this.output.appendLine(
			`[RPC] Starting Discord RPC with app ID: ${applicationId}`,
		);

		this.clearReconnectTimer();
		this.isConnecting = true;
		this.isReady = false;
		this.currentApplicationId = applicationId;

		try {
			if (this.client) {
				this.output.appendLine(
					"[RPC] Destroying stale client before reconnect.",
				);
				try {
					await this.client.destroy();
				} catch {
					// Ignore stale client destroy failures.
				}
				this.client = null;
			}

			this.output.appendLine("[RPC] Importing discord-rpc...");
			const rpc = (await import("discord-rpc")) as unknown as DiscordRpcModule;

			this.output.appendLine("[RPC] Registering Discord application...");
			rpc.register(applicationId);

			this.output.appendLine("[RPC] Creating IPC client...");
			const client = new rpc.Client({ transport: "ipc" });

			this.client = client;

			client.on("ready", () => {
				if (this.isDisposed) {
					return;
				}

				this.output.appendLine("[RPC] Discord RPC ready.");
				this.isReady = true;
				this.isConnecting = false;
				this.clearReconnectTimer();
				this.startHeartbeat();
				this.queueActivityUpdate();
			});

			client.on("disconnected", () => {
				if (this.isDisposed) {
					return;
				}

				this.output.appendLine("[RPC] Discord RPC disconnected.");
				this.isReady = false;
				this.isConnecting = false;
				this.client = null;
				this.clearHeartbeatTimer();
				this.scheduleReconnect();
			});

			client.on("error", (error) => {
				if (this.isDisposed) {
					return;
				}

				this.output.appendLine(`[RPC] Discord RPC error: ${String(error)}`);
				this.isReady = false;
				this.isConnecting = false;
				this.client = null;
				this.clearHeartbeatTimer();
				this.scheduleReconnect();
			});

			this.output.appendLine("[RPC] Logging in...");
			await client.login({ clientId: applicationId });

			this.output.appendLine("[RPC] Login promise resolved.");
		} catch (error) {
			this.output.appendLine(`[RPC] Failed to connect: ${String(error)}`);

			this.client = null;
			this.isConnecting = false;
			this.isReady = false;

			this.scheduleReconnect();
		}
	}

	private queueActivityUpdate(): void {
		if (this.isDisposed) {
			return;
		}

		this.clearUpdateTimer();

		this.updateTimer = setTimeout(() => {
			this.updateTimer = null;
			void this.updateActivity();
		}, 250);
	}

	private async updateActivity(): Promise<void> {
		if (this.isDisposed) {
			return;
		}

		if (!this.client) {
			this.output.appendLine("[RPC] Activity update skipped: no client.");
			return;
		}

		if (!this.isReady) {
			this.output.appendLine(
				"[RPC] Activity update skipped: client not ready.",
			);
			return;
		}

		const editor = vscode.window.activeTextEditor;
		const document = editor?.document;

		if (
			document &&
			(document.uri.scheme === "output" ||
				document.uri.scheme === "vscode-log" ||
				document.languageId.toLowerCase() === "log")
		) {
			this.output.appendLine(
				"[RPC] Activity update skipped: output/log editor.",
			);
			return;
		}

		const workspaceName =
			vscode.workspace.workspaceFolders?.[0]?.name ?? "No Workspace";

		const fileName = document
			? vscode.workspace.asRelativePath(document.uri)
			: "Browsing files";

		const languageId = document?.languageId ?? "none";
		const isBrickLua = languageId === "bricklua";
		const user = this.getCurrentUser?.() ?? null;
		const defaultSmallImageKey = isBrickLua ? "bricklua" : "vscode";
		const defaultSmallImageText = isBrickLua
			? "BrickLua File"
			: `Language: ${languageId}`;

		this.output.appendLine(
			`[RPC] Updating activity. file="${fileName}", language="${languageId}", workspace="${workspaceName}"`,
		);

		const projectConfig = await this.readWorkspaceProjectConfig();
		const worldId = projectConfig?.worldId?.trim();
		const universeId = projectConfig?.universeId?.trim();
		const gameUrl =
			worldId && universeId
				? `https://brickverse.gg/world/${encodeURIComponent(worldId)}`
				: undefined;

		if (worldId && !universeId) {
			this.output.appendLine(
				"[RPC] worldId is defined but universeId is missing in brickverse.project.json; View Game button will not be shown.",
			);
		}

		try {
			const activity: Record<string, unknown> = {
				details: document
					? `Editing ${fileName}`
					: "Browsing Workspace",
				state: `Workspace: ${workspaceName}`,
				largeImageKey: document ? "bricklua" : "workshop",
				largeImageText: document ? "BrickLua by brickverse.gg" : "BrickVerse Workshop",
				smallImageKey: user?.headshotUrl ?? defaultSmallImageKey,
				smallImageText: user
					? `Signed in as ${user.username ? `@${user.username}` : user.displayName}`
					: defaultSmallImageText,
				startTimestamp: this.startTimestamp,
				...(gameUrl
					? {
							buttons: [
								{
									label: "View Game",
									url: gameUrl,
								},
							],
						}
					: {}),
				instance: false,
			};

			try {
				await this.client.setActivity(activity);
			} catch (error) {
				if (user?.headshotUrl) {
					this.output.appendLine(
						`[RPC] Failed to apply user headshot image, retrying with default icon: ${String(error)}`,
					);

					activity.smallImageKey = defaultSmallImageKey;
					activity.smallImageText = defaultSmallImageText;
					await this.client.setActivity(activity);
				} else {
					throw error;
				}
			}

			this.output.appendLine("[RPC] Activity updated successfully.");
		} catch (error) {
			this.output.appendLine(
				`[RPC] Failed to update activity: ${String(error)}`,
			);

			this.isReady = false;
			this.client = null;
			this.scheduleReconnect();
		}
	}

	private scheduleReconnect(): void {
		if (this.isDisposed) {
			this.output.appendLine("[RPC] Reconnect skipped: manager disposed.");
			return;
		}

		if (this.reconnectTimer) {
			this.output.appendLine("[RPC] Reconnect already scheduled.");
			return;
		}

		if (!this.currentApplicationId) {
			this.output.appendLine("[RPC] Reconnect skipped: no application ID.");
			return;
		}

		const config = vscode.workspace.getConfiguration("bricklua.discordRpc");
		if (!config.get<boolean>("enabled", false)) {
			this.output.appendLine("[RPC] Reconnect skipped: RPC disabled.");
			return;
		}

		this.output.appendLine("[RPC] Scheduling reconnect in 3 seconds.");

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			void this.start(this.currentApplicationId);
		}, 3000);
	}

	private clearReconnectTimer(): void {
		if (!this.reconnectTimer) return;

		clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;

		this.output.appendLine("[RPC] Cleared reconnect timer.");
	}

	private clearUpdateTimer(): void {
		if (!this.updateTimer) return;

		clearTimeout(this.updateTimer);
		this.updateTimer = null;
	}

	private async hasBrickVerseProject(): Promise<boolean> {
		const match = await vscode.workspace.findFiles(
			"**/brickverse.project.json",
			"**/{node_modules,.git}/**",
			1,
		);

		return match.length > 0;
	}

	private async readWorkspaceProjectConfig(): Promise<BrickVerseProjectConfig | null> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return null;
		}

		const configUri = vscode.Uri.joinPath(
			folder.uri,
			"brickverse.project.json",
		);

		try {
			const raw = await vscode.workspace.fs.readFile(configUri);
			const parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as unknown;

			if (!parsed || typeof parsed !== "object") {
				return null;
			}

			const config = parsed as BrickVerseProjectConfig;

			return {
				worldId:
					typeof config.worldId === "string" ? config.worldId : undefined,
				universeId:
					typeof config.universeId === "string" ? config.universeId : undefined,
			};
		} catch {
			return null;
		}
	}
}
