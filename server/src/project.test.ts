// (c) 2026 Meta Games LLC. All rights reserved.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadBrickVerseProject } from "./project";

describe("BrickVerse project config", () => {
	it("loads brickverse.project.json and API file", async () => {
		const root = await fs.mkdtemp(
			path.join(os.tmpdir(), "brickverse-project-"),
		);
		const apiDir = path.join(root, ".brickverse");

		await fs.mkdir(apiDir);

		await fs.writeFile(
			path.join(root, "brickverse.project.json"),
			JSON.stringify(
				{
					name: "Test Game",
					engineVersion: "0.1.0",
					api: "./.brickverse/api.json",
				},
				null,
				2,
			),
		);

		await fs.writeFile(
			path.join(apiDir, "api.json"),
			JSON.stringify(
				{
					types: [{ name: "Node", kind: "class" }],
					globals: [{ name: "Workspace", kind: "service" }],
					functions: [{ name: "validateType", kind: "function" }],
				},
				null,
				2,
			),
		);

		const project = await loadBrickVerseProject(root);

		expect(project).not.toBeNull();
		expect(project?.config.name).toBe("Test Game");
		expect(project?.api?.types?.[0].name).toBe("Node");
		expect(project?.api?.globals?.[0].name).toBe("Workspace");
	});

	it("returns null when config is missing", async () => {
		const root = await fs.mkdtemp(
			path.join(os.tmpdir(), "brickverse-project-"),
		);

		const project = await loadBrickVerseProject(root);

		expect(project).toBeNull();
	});

	it("parses world and universe metadata from BrickVerse world endpoint", async () => {
		const root = await fs.mkdtemp(
			path.join(os.tmpdir(), "brickverse-project-"),
		);

		await fs.writeFile(
			path.join(root, "brickverse.project.json"),
			JSON.stringify(
				{
					name: "World Test",
					engineVersion: "0.1.0",
					worldId: "276115767638884352",
				},
				null,
				2,
			),
		);

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			const payload = {
				success: true,
				message: "World fetched successfully",
				world: {
					id: "276115767638884352",
					name: "World Testing Experience",
					universeId: "276115766217015296",
				},
				universe: {
					id: "276115766217015296",
					name: "World Testing Experience",
				},
			};

			return {
				ok: true,
				json: async () => payload,
			} as Response;
		}) as typeof fetch;

		try {
			const project = await loadBrickVerseProject(root);

			expect(project).not.toBeNull();
			expect(project?.world?.worldId).toBe("276115767638884352");
			expect(project?.world?.name).toBe("World Testing Experience");
			expect(project?.world?.universeId).toBe("276115766217015296");
			expect(project?.world?.universeName).toBe("World Testing Experience");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
