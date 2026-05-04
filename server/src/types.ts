export type BrickLuaApiEntryKind =
	| "class"
	| "struct"
	| "service"
	| "type"
	| "function"
	| "method"
	| "property"
	| "event"
	| "keyword"
	| "constant";

export interface BrickVerseProjectConfig {
	name: string;
	engineVersion?: string;
	api?: string;
	universeId?: string;
	worldId?: string;
}

export interface BrickVerseWorldInfo {
	worldId: string;
	name: string;
	universeId?: string;
	universeName?: string;
	raw?: unknown;
}

export interface BrickLuaApiEntry {
	name: string;
	kind?: BrickLuaApiEntryKind | string;
	type?: string;
	signature?: string;
	description?: string;
	documentation?: string;
	parameters?: Array<{
		name: string;
		type: string;
		description?: string;
		optional?: boolean;
	}>;
	returns?: {
		type: string;
		description?: string;
	};
	examples?: string[];
}

export interface BrickLuaApiDefinition {
	globals?: BrickLuaApiEntry[];
	types?: BrickLuaApiEntry[];
	functions?: BrickLuaApiEntry[];
	keywords?: BrickLuaApiEntry[];
	constants?: BrickLuaApiEntry[];
}

export interface LoadedBrickVerseProject {
	workspaceRoot: string;
	configPath: string;
	config: BrickVerseProjectConfig;
	apiPath?: string;
	api?: BrickLuaApiDefinition;
	world?: BrickVerseWorldInfo;
}

export interface WorkspaceChangedNotificationParams {
	workspaceRoot: string;
}

export interface ValidationOptions {
	knownTypes?: string[];
}
