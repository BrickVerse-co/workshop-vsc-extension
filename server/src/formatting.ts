import {
	FormattingOptions,
	Position,
	Range,
	TextEdit,
} from "vscode-languageserver/node";

const BLOCK_OPENERS = /\b(function|if|do|for|while|repeat)\b/g;
const BLOCK_CLOSERS = /\b(end|until)\b/g;
const TRIGGER_REINDENT_AFTER_LINE = /^\s*(else|elseif)\b/;

export function formatBrickLuaText(
	text: string,
	options: FormattingOptions,
): string {
	const lines = text.split(/\r?\n/);
	const indentUnit = options.insertSpaces
		? " ".repeat(Math.max(options.tabSize, 1))
		: "\t";

	let indentLevel = 0;
	const formattedLines = lines.map((line) => {
		const trimmedLine = line.trim();
		if (trimmedLine.length === 0) {
			return "";
		}

		const code = stripStringsAndComments(trimmedLine);
		const shouldDedentBeforeLine = startsWithBlockMiddleOrCloser(code);
		const appliedIndentLevel = Math.max(
			indentLevel - (shouldDedentBeforeLine ? 1 : 0),
			0,
		);

		const formattedLine = `${indentUnit.repeat(appliedIndentLevel)}${trimmedLine}`;
		indentLevel =
			appliedIndentLevel + countBlockOpeners(code) - countBlockClosers(code);

		if (TRIGGER_REINDENT_AFTER_LINE.test(code)) {
			indentLevel += 1;
		}

		indentLevel = Math.max(indentLevel, 0);
		return formattedLine;
	});

	return formattedLines.join("\n");
}

export function createDocumentFormattingEdit(
	text: string,
	options: FormattingOptions,
): TextEdit[] {
	const formattedText = formatBrickLuaText(text, options);
	if (formattedText === text) {
		return [];
	}

	return [
		TextEdit.replace(
			Range.create(Position.create(0, 0), fullDocumentEnd(text)),
			formattedText,
		),
	];
}

function fullDocumentEnd(text: string): Position {
	const lines = text.split(/\r?\n/);
	const lastLine = lines.at(-1) ?? "";

	return Position.create(lines.length - 1, lastLine.length);
}

function startsWithBlockMiddleOrCloser(code: string): boolean {
	return /^\s*(else|elseif|end|until)\b/.test(code);
}

function countBlockOpeners(code: string): number {
	return [...code.matchAll(BLOCK_OPENERS)].length;
}

function countBlockClosers(code: string): number {
	return [...code.matchAll(BLOCK_CLOSERS)].length;
}

function stripStringsAndComments(line: string): string {
	let result = "";
	let activeQuote: string | null = null;

	for (let index = 0; index < line.length; index++) {
		const character = line[index];
		const nextCharacter = line[index + 1];

		if (!activeQuote && character === "-" && nextCharacter === "-") {
			break;
		}

		if ((character === '"' || character === "'") && line[index - 1] !== "\\") {
			if (!activeQuote) {
				activeQuote = character;
				result += " ";
				continue;
			}

			if (activeQuote === character) {
				activeQuote = null;
				result += " ";
				continue;
			}
		}

		result += activeQuote ? " " : character;
	}

	return result;
}
