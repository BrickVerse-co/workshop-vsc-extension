import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const luaApiPath = path.join(root, "resources", "default-lua-api.json");
const engineApiPath = path.join(root, "resources", "default-engine-api.json");
const grammarBasePath = path.join(
	root,
	"syntaxes",
	"bricklua.tmLanguage.base.json",
);
const grammarPath = path.join(root, "syntaxes", "bricklua.tmLanguage.json");
const languageConfigBasePath = path.join(
	root,
	"language-configuration.base.json",
);
const languageConfigPath = path.join(root, "language-configuration.json");

const luaApi = JSON.parse(await readFile(luaApiPath, "utf8"));
const engineApi = JSON.parse(await readFile(engineApiPath, "utf8"));
const grammar = JSON.parse(await readFile(grammarBasePath, "utf8"));
const languageConfig = JSON.parse(
	await readFile(languageConfigBasePath, "utf8"),
);

grammar.$comment =
	"AUTO-GENERATED FILE. DO NOT EDIT. Run npm run generate:language.";
languageConfig.$comment =
	"AUTO-GENERATED FILE. DO NOT EDIT. Run npm run generate:language.";

const luaKeywordSet = new Set(
	(luaApi.keywords ?? []).map((entry) => entry.name),
);
const luaConstantSet = new Set(
	(luaApi.constants ?? []).map((entry) => entry.name),
);
const luaTypeSet = new Set((luaApi.types ?? []).map((entry) => entry.name));
const luaFunctionSet = new Set(
	(luaApi.functions ?? []).map((entry) => entry.name),
);

const engineTypeSet = new Set(
	(engineApi.types ?? []).map((entry) => entry.name),
);
const engineGlobalSet = new Set(
	(engineApi.globals ?? []).map((entry) => entry.name),
);
const engineFunctionSet = new Set(
	(engineApi.functions ?? []).map((entry) => entry.name),
);

const keywordControl = [...luaKeywordSet].filter(
	(name) => name !== "local" && name !== "type",
);
const storageModifiers = ["local"];
const declarationKeywords = ["type"];

const primitiveTypes = [...luaTypeSet];
const engineTypes = [...new Set([...engineTypeSet, ...engineGlobalSet])];
const engineGlobalTokens = expandQualifiedNames([...engineGlobalSet]);
const builtinFunctions = [
	...new Set([...luaFunctionSet, ...engineFunctionSet]),
];

setPattern(
	grammar,
	["repository", "keywords", "patterns", 0, "match"],
	makeWordMatch(keywordControl),
);
setPattern(
	grammar,
	["repository", "keywords", "patterns", 1, "match"],
	makeWordMatch(storageModifiers),
);
setPattern(
	grammar,
	["repository", "keywords", "patterns", 2, "match"],
	makeWordMatch([...luaConstantSet]),
);
setPattern(
	grammar,
	["repository", "keywords", "patterns", 3, "match"],
	makeWordMatch(declarationKeywords),
);
setPattern(
	grammar,
	["repository", "types", "patterns", 0, "match"],
	makeWordMatch(primitiveTypes),
);
setPattern(
	grammar,
	["repository", "types", "patterns", 1, "match"],
	makeWordMatch(engineTypes),
);
setPattern(
	grammar,
	["repository", "engineGlobals", "patterns", 0, "match"],
	makeWordMatch(engineGlobalTokens),
);
setPattern(
	grammar,
	["repository", "functions", "patterns", 2, "match"],
	`${makeWordMatch(builtinFunctions)}(?=\\s*\\()`,
);

const blockOpeners = intersection(luaKeywordSet, [
	"function",
	"if",
	"for",
	"while",
	"repeat",
	"do",
]);
const blockClosers = intersection(luaKeywordSet, [
	"end",
	"elseif",
	"else",
	"until",
]);

languageConfig.indentationRules = {
	increaseIndentPattern: buildIncreaseIndentPattern(blockOpeners),
	decreaseIndentPattern: buildDecreaseIndentPattern(blockClosers),
};

await writeFile(grammarPath, `${JSON.stringify(grammar, null, 2)}\n`, "utf8");
await writeFile(
	languageConfigPath,
	`${JSON.stringify(languageConfig, null, 2)}\n`,
	"utf8",
);

function makeWordMatch(words) {
	if (!words.length) return "\\b(?!x)x\\b";
	return `\\b(${words.map(escapeRegex).sort().join("|")})\\b`;
}

function intersection(sourceSet, expectedValues) {
	return expectedValues.filter((item) => sourceSet.has(item));
}

function expandQualifiedNames(names) {
	const tokens = new Set();

	for (const name of names) {
		tokens.add(name);
		for (const part of name.split(".")) {
			if (part) tokens.add(part);
		}
	}

	return [...tokens];
}

function buildIncreaseIndentPattern(openers) {
	const has = new Set(openers);
	const parts = [];

	if (has.has("function")) {
		parts.push("(local\\s+)?function\\b.*");
	}
	if (has.has("if")) {
		parts.push("if\\b.*\\bthen\\b");
	}
	if (has.has("for")) {
		parts.push("for\\b.*\\bdo\\b");
	}
	if (has.has("while")) {
		parts.push("while\\b.*\\bdo\\b");
	}
	if (has.has("repeat")) {
		parts.push("repeat\\b");
	}
	if (has.has("do")) {
		parts.push("do\\b");
	}

	if (!parts.length) {
		return "^\\s*$";
	}

	return `^\\s*(${parts.join("|")})\\s*$`;
}

function buildDecreaseIndentPattern(closers) {
	const has = new Set(closers);
	const parts = [];

	if (has.has("end")) {
		parts.push("end");
	}
	if (has.has("elseif")) {
		parts.push("elseif\\b.*\\bthen\\b");
	}
	if (has.has("else")) {
		parts.push("else\\b");
	}
	if (has.has("until")) {
		parts.push("until\\b.*");
	}

	if (!parts.length) {
		return "^\\s*$";
	}

	return `^\\s*(${parts.join("|")})\\s*$`;
}

function setPattern(target, pathParts, value) {
	let cursor = target;
	for (let i = 0; i < pathParts.length - 1; i++) {
		cursor = cursor[pathParts[i]];
	}
	cursor[pathParts[pathParts.length - 1]] = value;
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
