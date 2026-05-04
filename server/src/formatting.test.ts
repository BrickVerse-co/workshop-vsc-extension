import { describe, expect, it } from "vitest";
import { formatBrickLuaText } from "./formatting";

describe("BrickLua formatting", () => {
	it("indents nested blocks", () => {
		const formatted = formatBrickLuaText(
			[
				"function Start()",
				'print("hi")',
				"if ready then",
				'print("go")',
				"end",
				"end",
			].join("\n"),
			{ insertSpaces: true, tabSize: 2 },
		);

		expect(formatted).toBe(
			[
				"function Start()",
				'  print("hi")',
				"  if ready then",
				'    print("go")',
				"  end",
				"end",
			].join("\n"),
		);
	});

	it("aligns else branches and respects tabs", () => {
		const formatted = formatBrickLuaText(
			["if ready then", 'print("go")', "else", 'print("wait")', "end"].join(
				"\n",
			),
			{ insertSpaces: false, tabSize: 4 },
		);

		expect(formatted).toBe(
			["if ready then", '\tprint("go")', "else", '\tprint("wait")', "end"].join(
				"\n",
			),
		);
	});

	it("ignores keywords inside strings and comments", () => {
		const formatted = formatBrickLuaText(
			[
				"function Start()",
				'print("end") -- if this breaks indentation',
				"end",
			].join("\n"),
			{ insertSpaces: true, tabSize: 4 },
		);

		expect(formatted).toBe(
			[
				"function Start()",
				'    print("end") -- if this breaks indentation',
				"end",
			].join("\n"),
		);
	});
});
