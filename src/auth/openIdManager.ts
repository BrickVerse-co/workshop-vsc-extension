import * as crypto from "node:crypto";
import * as http from "node:http";
import * as vscode from "vscode";

interface OpenIdConfiguration {
	authorization_endpoint: string;
	token_endpoint: string;
	userinfo_endpoint?: string;
}

interface OpenIdTokenResponse {
	access_token: string;
	refresh_token?: string;
	id_token?: string;
	expires_in?: number;
	token_type?: string;
	scope?: string;
}

interface BrickVerseUser {
	/** OIDC `sub` claim */
	id: string;
	/** OIDC `name` claim */
	displayName: string;
	/** OIDC `preferred_username` claim */
	username?: string;
	/** OIDC `email` claim */
	email?: string;
	/** OIDC `email_verified` claim */
	emailVerified?: boolean;
	/** BrickVerse numeric user ID (`userId` claim) */
	userId?: string;
	/** URL to the user's headshot thumbnail (`headshotUrl` claim) */
	headshotUrl?: string;
	/** URL to the user's full body thumbnail (`bodyshotUrl` claim) */
	bodyshotUrl?: string;
}

interface PendingAuthRequest {
	state: string;
	resolve: (code: string) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

const TOKENS_SECRET_KEY = "bricklua.openid.tokens";
const USER_SECRET_KEY = "bricklua.openid.user";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const CALLBACK_OK_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>BrickVerse Login</title></head><body><h2>BrickVerse login complete</h2><p>You can close this tab and return to VS Code.</p></body></html>`;

export class OpenIdManager implements vscode.Disposable {
	private readonly pendingRequests = new Map<string, PendingAuthRequest>();
	private readonly statusBarItem: vscode.StatusBarItem;
	private currentUser: BrickVerseUser | null = null;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			90,
		);
		this.statusBarItem.name = "BrickVerse OpenID";
		this.statusBarItem.command = "bricklua.openId.openAccountMenu";
		this.statusBarItem.show();

		void this.restoreSession();
	}

	async login(): Promise<void> {
		const config = vscode.workspace.getConfiguration("bricklua.openId");
		const clientId = config.get<string>("clientId", "").trim();
		const scopes = config.get<string>("scopes", "openid profile email").trim();
		const discoveryUrl = config.get<string>(
			"discoveryUrl",
			"https://api.brickverse.gg/.well-known/openid-configuration",
		);

		if (!clientId) {
			vscode.window.showWarningMessage(
				"Set bricklua.openId.clientId before signing in.",
			);
			await vscode.commands.executeCommand(
				"workbench.action.openSettings",
				"bricklua.openId.clientId",
			);
			return;
		}

		const oidc = await this.fetchOpenIdConfiguration(discoveryUrl);
		const codeVerifier = createCodeVerifier();
		const codeChallenge = createCodeChallenge(codeVerifier);
		const state = crypto.randomUUID();
		const redirectUri = this.getRedirectUri();

		const authUrl = new URL(config.get<string>("authorizationEndpoint", oidc.authorization_endpoint));
		authUrl.searchParams.set("response_type", "code");
		authUrl.searchParams.set("client_id", clientId);
		authUrl.searchParams.set("redirect_uri", redirectUri);
		authUrl.searchParams.set("scope", scopes);
		authUrl.searchParams.set("state", state);
		authUrl.searchParams.set("code_challenge", codeChallenge);
		authUrl.searchParams.set("code_challenge_method", "S256");

		const authUri = vscode.Uri.parse(authUrl.toString());

		const code = await this.waitForAuthorizationCode({
			state,
			authUri,
			redirectUri,
		});
		const tokenResponse = await this.exchangeAuthorizationCode({
			oidc,
			code,
			clientId,
			codeVerifier,
			redirectUri,
		});

		const user = await this.fetchCurrentUser(oidc, tokenResponse.access_token);
		await this.persistSession(tokenResponse, user);

		this.currentUser = user;
		this.updateStatusBar();
		vscode.window.showInformationMessage(
			`Signed in to BrickVerse as ${user.displayName}.`,
		);
	}

	async logout(): Promise<void> {
		this.currentUser = null;
		await this.context.secrets.delete(TOKENS_SECRET_KEY);
		await this.context.secrets.delete(USER_SECRET_KEY);
		this.updateStatusBar();
		vscode.window.showInformationMessage("Signed out from BrickVerse.");
	}

	getCurrentUser(): BrickVerseUser | null {
		return this.currentUser;
	}

	isLoggedIn(): boolean {
		return !!this.currentUser;
	}

	async openAccountMenu(): Promise<void> {
		if (!this.isLoggedIn()) {
			const choice = await vscode.window.showQuickPick(
				[
					{
						label: "$(sign-in) Sign In",
						description: "Authenticate with your BrickVerse account",
						id: "login",
					},
					{
						label: "$(settings-gear) Open OpenID Settings",
						id: "settings",
					},
				],
				{ title: "BrickVerse Account", ignoreFocusOut: true },
			);

			if (choice?.id === "login") await this.login();
			else if (choice?.id === "settings")
				await vscode.commands.executeCommand(
					"workbench.action.openSettings",
					"bricklua.openId",
				);
			return;
		}

		const user = this.currentUser!;
		const usernameLabel = user.username
			? `@${user.username}`
			: user.displayName;
		const emailDetail = user.email
			? `${user.email}${user.emailVerified === true ? "  ✓ verified" : "  (unverified)"}`
			: undefined;
		const userIdDetail = user.userId ? `User ID: ${user.userId}` : undefined;

		const infoLines = [usernameLabel];
		if (user.displayName && user.displayName !== user.username)
			infoLines.push(user.displayName);
		if (emailDetail) infoLines.push(emailDetail);
		if (userIdDetail) infoLines.push(userIdDetail);

		const items: (vscode.QuickPickItem & { id?: string })[] = [
			{
				label: "BrickVerse Account",
				kind: vscode.QuickPickItemKind.Separator,
			},
			{
				label: `$(account) ${user.displayName}`,
				description: user.username ? `@${user.username}` : undefined,
				detail:
					[userIdDetail, emailDetail].filter(Boolean).join("   •   ") ||
					undefined,
				id: "_info",
			},
			{
				label: "Actions",
				kind: vscode.QuickPickItemKind.Separator,
			},
		];

		if (user.headshotUrl) {
			items.push({
				label: "$(person) View Avatar",
				description: "Open headshot in browser",
				id: "avatar",
			});
		}

		if (user.userId) {
			items.push({
				label: "$(link-external) Open Profile Page",
				description: `brickverse.gg/users/${user.userId}`,
				id: "profile",
			});
			items.push({
				label: "$(copy) Copy User ID",
				description: user.userId,
				id: "copyId",
			});
		}

		items.push({
			label: "$(settings-gear) OpenID Settings",
			id: "settings",
		});

		items.push({
			label: "Account",
			kind: vscode.QuickPickItemKind.Separator,
		});

		items.push({
			label: "$(sign-out) Sign Out",
			description: `Signed in as ${usernameLabel}`,
			id: "logout",
		});

		const choice = await vscode.window.showQuickPick(items, {
			title: "BrickVerse Account",
			ignoreFocusOut: true,
			matchOnDescription: false,
			matchOnDetail: false,
		});

		switch ((choice as { id?: string } | undefined)?.id) {
			case "avatar":
				if (user.headshotUrl)
					await vscode.env.openExternal(vscode.Uri.parse(user.headshotUrl));
				return;
			case "profile":
				if (user.userId)
					await vscode.env.openExternal(
						vscode.Uri.parse(`https://www.brickverse.gg/users/${user.userId}`),
					);
				return;
			case "copyId":
				if (user.userId) await vscode.env.clipboard.writeText(user.userId);
				vscode.window.showInformationMessage(
					`Copied User ID ${user.userId} to clipboard.`,
				);
				return;
			case "settings":
				await vscode.commands.executeCommand(
					"workbench.action.openSettings",
					"bricklua.openId",
				);
				return;
			case "logout":
				await this.logout();
				return;
			default:
				return;
		}
	}

	dispose(): void {
		for (const pending of this.pendingRequests.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error("OpenID flow cancelled."));
		}
		this.pendingRequests.clear();
		this.statusBarItem.dispose();
	}

	private async restoreSession(): Promise<void> {
		const raw = await this.context.secrets.get(USER_SECRET_KEY);
		if (!raw) {
			this.currentUser = null;
			this.updateStatusBar();
			return;
		}

		try {
			this.currentUser = JSON.parse(raw) as BrickVerseUser;
		} catch {
			this.currentUser = null;
		}

		this.updateStatusBar();
	}

	private updateStatusBar(): void {
		if (this.currentUser) {
			this.statusBarItem.text = `$(account) ${this.currentUser.displayName}`;
			this.statusBarItem.tooltip = "BrickVerse account: Open account menu";
			return;
		}

		this.statusBarItem.text = "$(account) Sign in";
		this.statusBarItem.tooltip = "Sign in to BrickVerse OpenID";
	}

	private async waitForAuthorizationCode(params: {
		state: string;
		authUri: vscode.Uri;
		redirectUri: string;
	}): Promise<string> {
		const { state, authUri, redirectUri } = params;
		const callbackUrl = new URL(redirectUri);

		const codePromise = new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(state);
				reject(new Error("OpenID login timed out."));
			}, AUTH_TIMEOUT_MS);

			this.pendingRequests.set(state, { state, resolve, reject, timer });
		});

		const callbackPromise = new Promise<void>((resolve, reject) => {
			const server = http.createServer((req, res) => {
				try {
					if (!req.url) {
						res.statusCode = 400;
						res.end("Missing callback URL");
						return;
					}

					const requestUrl = new URL(req.url, `http://${callbackUrl.host}`);

					if (requestUrl.pathname !== callbackUrl.pathname) {
						res.statusCode = 404;
						res.end("Not found");
						return;
					}

					const requestState = requestUrl.searchParams.get("state");
					if (!requestState) {
						res.statusCode = 400;
						res.end("Missing state");
						return;
					}

					const pending = this.pendingRequests.get(requestState);
					if (!pending) {
						res.statusCode = 400;
						res.end("Unknown state");
						return;
					}

					clearTimeout(pending.timer);
					this.pendingRequests.delete(requestState);

					const error = requestUrl.searchParams.get("error");
					if (error) {
						pending.reject(new Error(error));
						res.statusCode = 400;
						res.end(`OpenID error: ${error}`);
						return;
					}

					const code = requestUrl.searchParams.get("code");
					if (!code) {
						pending.reject(new Error("Missing authorization code."));
						res.statusCode = 400;
						res.end("Missing authorization code");
						return;
					}

					pending.resolve(code);
					res.statusCode = 200;
					res.setHeader("Content-Type", "text/html; charset=utf-8");
					res.end(CALLBACK_OK_HTML);
				} finally {
					server.close(() => resolve());
				}
			});

			server.on("error", (error) => {
				reject(error);
			});

			server.listen(parseInt(callbackUrl.port, 10), callbackUrl.hostname);
		});

		await vscode.env.openExternal(authUri);
		const code = await codePromise;
		await callbackPromise;
		return code;
	}

	private getRedirectUri(): string {
		const config = vscode.workspace.getConfiguration("bricklua.openId");
		const redirectUri = config
			.get<string>("redirectUri", "http://127.0.0.1:38961/auth/callback")
			.trim();

		let url: URL;
		try {
			url = new URL(redirectUri);
		} catch {
			throw new Error("bricklua.openId.redirectUri must be a valid URL.");
		}

		if (url.protocol !== "http:") {
			throw new Error("bricklua.openId.redirectUri must use http://.");
		}

		if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
			throw new Error(
				"bricklua.openId.redirectUri hostname must be localhost or 127.0.0.1.",
			);
		}

		if (!url.port) {
			throw new Error(
				"bricklua.openId.redirectUri must include an explicit port.",
			);
		}

		if (!url.pathname || url.pathname === "/") {
			throw new Error(
				"bricklua.openId.redirectUri should include a callback path, for example /auth/callback.",
			);
		}

		return url.toString();
	}

	private async fetchOpenIdConfiguration(
		discoveryUrl: string,
	): Promise<OpenIdConfiguration> {
		const response = await fetch(discoveryUrl);
		if (!response.ok) {
			throw new Error(`OpenID discovery failed (${response.status}).`);
		}

		const data = (await response.json()) as Partial<OpenIdConfiguration>;
		if (!data.authorization_endpoint || !data.token_endpoint) {
			throw new Error("OpenID configuration is missing required endpoints.");
		}

		return {
			authorization_endpoint: data.authorization_endpoint,
			token_endpoint: data.token_endpoint,
			userinfo_endpoint: data.userinfo_endpoint,
		};
	}

	private async exchangeAuthorizationCode(params: {
		oidc: OpenIdConfiguration;
		code: string;
		clientId: string;
		codeVerifier: string;
		redirectUri: string;
	}): Promise<OpenIdTokenResponse> {
		const body = new URLSearchParams({
			grant_type: "authorization_code",
			code: params.code,
			client_id: params.clientId,
			code_verifier: params.codeVerifier,
			redirect_uri: params.redirectUri
		});

		const response = await fetch(params.oidc.token_endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body,
		});

		if (!response.ok) {
			throw new Error(`Token exchange failed (${response.status}).`);
		}

		return (await response.json()) as OpenIdTokenResponse;
	}

	private async fetchCurrentUser(
		oidc: OpenIdConfiguration,
		accessToken: string,
	): Promise<BrickVerseUser> {
		if (oidc.userinfo_endpoint) {
			const response = await fetch(oidc.userinfo_endpoint, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			});

			if (response.ok) {
				const userInfo = (await response.json()) as Record<string, unknown>;
				return {
					id: String(userInfo.sub ?? userInfo.id ?? "unknown"),
					displayName: String(
						userInfo.name ??
							userInfo.preferred_username ??
							userInfo.sub ??
							"BrickVerse User",
					),
					username:
						typeof userInfo.preferred_username === "string"
							? userInfo.preferred_username
							: undefined,
					email:
						typeof userInfo.email === "string" ? userInfo.email : undefined,
					emailVerified:
						typeof userInfo.email_verified === "boolean"
							? userInfo.email_verified
							: undefined,
					userId: userInfo.userId != null ? String(userInfo.userId) : undefined,
					headshotUrl:
						typeof userInfo.headshotUrl === "string"
							? userInfo.headshotUrl
							: undefined,
					bodyshotUrl:
						typeof userInfo.bodyshotUrl === "string"
							? userInfo.bodyshotUrl
							: undefined,
				};
			}
		}

		return {
			id: "unknown",
			displayName: "BrickVerse User",
		};
	}

	private async persistSession(
		tokens: OpenIdTokenResponse,
		user: BrickVerseUser,
	): Promise<void> {
		await this.context.secrets.store(TOKENS_SECRET_KEY, JSON.stringify(tokens));
		await this.context.secrets.store(USER_SECRET_KEY, JSON.stringify(user));
	}
}

function createCodeVerifier(): string {
	return base64UrlEncode(crypto.randomBytes(32));
}

function createCodeChallenge(verifier: string): string {
	const hash = crypto.createHash("sha256").update(verifier).digest();
	return base64UrlEncode(hash);
}

function base64UrlEncode(input: Buffer): string {
	return input
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}
