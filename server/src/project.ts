// (c) 2026 Meta Games LLC. All rights reserved.

import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
	type BrickLuaApiDefinition,
	type BrickVerseWorldInfo,
	type BrickVerseProjectConfig,
	type LoadedBrickVerseProject,
} from "./types";

export async function loadBrickVerseProject(
	workspaceRoot: string,
): Promise<LoadedBrickVerseProject | null> {
	const configPath = path.join(workspaceRoot, "brickverse.project.json");

	if (!(await exists(configPath))) {
		return null;
	}

	const configRaw = await fs.readFile(configPath, "utf8");
	const config = JSON.parse(configRaw) as BrickVerseProjectConfig;

	const loaded: LoadedBrickVerseProject = {
		workspaceRoot,
		configPath,
		config,
	};

	if (config.api) {
		const apiPath = path.resolve(workspaceRoot, config.api);

		if (await exists(apiPath)) {
			const apiRaw = await fs.readFile(apiPath, "utf8");

			loaded.apiPath = apiPath;
			loaded.api = JSON.parse(apiRaw) as BrickLuaApiDefinition;
		}
	}

	if (config.worldId) {
		loaded.world = await loadWorldInfo(config.worldId, config.universeId);
	}

	return loaded;
}

async function loadWorldInfo(
	worldId: string,
	universeId?: string,
): Promise<BrickVerseWorldInfo | undefined> {
	try {
		const response = await fetch(
			`https://api.brickverse.gg/api/v3/world/${encodeURIComponent(worldId)}`,
			{
				headers: {
					Accept: "application/json",
				},
			},
		);

		if (!response.ok) {
			return {
				worldId,
				universeId,
				name: `World ${worldId}`,
			};
		}

		const data = (await response.json()) as Record<string, unknown>;
		const worldPayload =
			typeof data.world === "object" && data.world
				? (data.world as Record<string, unknown>)
				: data;
		const universePayload =
			typeof data.universe === "object" && data.universe
				? (data.universe as Record<string, unknown>)
				: undefined;

		const name =
			typeof worldPayload.name === "string"
				? worldPayload.name
				: typeof worldPayload.title === "string"
					? worldPayload.title
					: `World ${worldId}`;

		const resolvedWorldId =
			typeof worldPayload.id === "string" ? worldPayload.id : worldId;

		const resolvedUniverseId =
			universeId ??
			(typeof worldPayload.universeId === "string"
				? worldPayload.universeId
				: typeof universePayload?.id === "string"
					? universePayload.id
					: undefined);

		const universeName =
			typeof universePayload?.name === "string"
				? universePayload.name
				: undefined;

		return {
			worldId: resolvedWorldId,
			universeId: resolvedUniverseId,
			universeName,
			name,
			raw: data,
		};
	} catch {
		return {
			worldId,
			universeId,
			name: `World ${worldId}`,
		};
	}
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}
