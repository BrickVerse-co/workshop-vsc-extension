import { describe, expect, it } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { validateBrickLuaText } from "./validation";

describe("BrickLua validation", () => {
	it("allows valid typed locals", () => {
		const diagnostics = validateBrickLuaText(`
local name: string = "Builder"
local coins: number = 100
local enabled: boolean = true
`);

		expect(diagnostics).toHaveLength(0);
	});

	it("detects string assigned to number", () => {
		const diagnostics = validateBrickLuaText(`
local coins: number = "wrong"
`);

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
		expect(diagnostics[0].message).toContain("Type mismatch");
	});

	it("detects missing end", () => {
		const diagnostics = validateBrickLuaText(`
function Start()
	print("Hello")
`);

		expect(diagnostics.length).toBeGreaterThan(0);
		expect(diagnostics[0].message).toContain("missing a closing");
	});

	it("detects unexpected end", () => {
		const diagnostics = validateBrickLuaText(`
print("Hello")
end
`);

		expect(diagnostics.length).toBeGreaterThan(0);
		expect(diagnostics[0].message).toContain("Unexpected 'end'");
	});

	it("ignores comments", () => {
		const diagnostics = validateBrickLuaText(`
-- function Broken()
local name: string = "Builder"
`);

		expect(diagnostics).toHaveLength(0);
	});

	it("allows custom project API types", () => {
		const diagnostics = validateBrickLuaText(
			`
local node: Node = script.Parent
local pos: Vector3 = Vector3.new(0, 1, 0)
`,
			{
				knownTypes: ["Node", "Vector3"],
			},
		);

		expect(diagnostics).toHaveLength(0);
	});

	it("detects unknown type annotations", () => {
		const diagnostics = validateBrickLuaText(
			`
local thing: FakeType = nil
`,
			{
				knownTypes: ["Node"],
			},
		);

		expect(diagnostics.length).toBeGreaterThan(0);
		expect(diagnostics[0].message).toContain("Unknown BrickLua type");
	});
});
