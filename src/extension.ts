import * as vscode from 'vscode';

const DELIMITERS = ["\"\"", "\'\'", "\`\`", "()", "[]", "{}", "< "]

const DO_NOT_BEGIN = ["/*", "//", "#", "--", "<!--"]

type IndentStyleDef = {
	arm: vscode.TextEditorDecorationType,
	bar: vscode.TextEditorDecorationType
}

function createIndentStyleDef(
	level: number
): IndentStyleDef {
	const COLOURS = [
		"#ffaac4", 
		"#ffafa2", 
		"#ffb475", 
		"#f1c000", 
		"#b7d800", 
		"#49e97d", 
		"#00e6ca", 
		"#00dffa", 
		"#8ccfff", 
		"#b1c5ff", 
		"#d0b8ff", 
		"#ff9ff7"
	];
	let arm = vscode.window.createTextEditorDecorationType({
		color: COLOURS[level],
		borderRadius: "2px"
	})
	let bar = vscode.window.createTextEditorDecorationType({
		before: {
			contentText: "|",
			color: "transparent",
			backgroundColor: `color-mix(in srgb, ${COLOURS[level]} 40%, var(--vscode-editor-background))`,
			textDecoration: `; position: absolute; width: 2px; height: 100%; top: 0; z-index: -2`
		}
	})
	return {
		arm: arm,
		bar: bar
	}
}

type IndentStyleActual = {
	arm: vscode.DecorationOptions[],
	bar: vscode.DecorationOptions[]
}

function createIndentStyleActual(): IndentStyleActual {
	return {
		arm: [],
		bar: []
	}
}

function applyIndentStyle(
	editor: vscode.TextEditor,
	definition: IndentStyleDef,
	actual: IndentStyleActual
) {
	editor.setDecorations(definition.arm, actual.arm);
	editor.setDecorations(definition.bar, actual.bar);
}

function measureIndentation(
	line: string,
	tabSize: number
): number {
	let columns = 0
	for(let index = 0; index < line.length; index++) {
		const char = line.charAt(index);
		if (char == " ") {
			columns += 1;
		} else if (char == "\t") {
			columns += tabSize;
		} else {
			break;
		}
	}
	return columns;
}

function getEditorTabSize(
	editor: vscode.TextEditor
): number {
	const tabSize = editor.options.tabSize;
	if (tabSize === undefined || typeof tabSize === "string") {
		return 4;
	} else {
		return tabSize;
	}
}

type IndentSpan = {
	column: number,
	startLine: number,
	endLine: number,
	splits: number[]
}

function updateDecorations(
	editor: vscode.TextEditor,
	styleDefs: IndentStyleDef[]
) {
	console.log("[cuddle] Updating decorations...");

	const numStyles = styleDefs.length;
	const tabSize = getEditorTabSize(editor);
	const lines = editor.document.getText().split(/\r\n|\r|\n/);
	const numLines = lines.length;
	const styleActuals: IndentStyleActual[] = styleDefs.map(createIndentStyleActual);

	console.log("[cuddle] -> Calculating indentations");
	let indentations: number[] = [];
	let emptyLines: boolean[] = [];
	for(let lineNumber = 0; lineNumber < numLines; lineNumber++) {
		const line = lines[lineNumber];
		if (line.trimEnd().length === 0) {
			// Empty lines don't affect the visual layout of groups, so should not be considered.
			indentations[lineNumber] = lineNumber > 0 ? indentations[lineNumber - 1] : 0;
		} else {
			indentations[lineNumber] = measureIndentation(line, tabSize);
		}
	}
	console.log(`[cuddle] -> ...indented ${indentations.length} lines`);

	console.log("[cuddle] -> Measuring spans");
	const completedSpans: IndentSpan[] = [];
	const inProgressSpans: IndentSpan[] = [];
	for(let lineNumber = 0; lineNumber < numLines; lineNumber++) {
		const line = lines[lineNumber];
		const thisIndentation = indentations[lineNumber];
		const hasContent = line.length > 0;
		let isOpening = false;
		if (hasContent && lineNumber + 1 < numLines) {
			const nextIndentation = indentations[lineNumber + 1];
			if (thisIndentation < nextIndentation) {
				isOpening = true;
				const trimmed = line.trimStart();
				for(const ignore of DO_NOT_BEGIN) {
					if (trimmed.startsWith(ignore)) {
						isOpening = false;
						break;
					}
				}
			}
		}
		if (hasContent && lineNumber - 1 >= 0) {
			const prevIndentation = indentations[lineNumber - 1];
			if (prevIndentation > thisIndentation) {
				while (true) {
					const span = inProgressSpans.pop();
					if (span === undefined) {
						break;
					} else if (span.column == thisIndentation) {
						if (isOpening) {
							isOpening = false;
							span.splits.push(lineNumber);
							inProgressSpans.push(span);
						} else {
							span.endLine = lineNumber;
							completedSpans.push(span)
						}
						break;
					} else if (span.column < thisIndentation) {
						inProgressSpans.push(span); 
						break;
					}
				}
			}
		}
		if (isOpening) {
			inProgressSpans.push({
				column: thisIndentation,
				startLine: lineNumber,
				endLine: -1,
				splits: []
			})
		}
	}
	console.log(`[cuddle] -> ...measured ${completedSpans.length} spans, with ${inProgressSpans.length} hanging`);

	console.log("[cuddle] -> Sorting spans");
	completedSpans.sort((a, b) => a.startLine - b.startLine);

	console.log("[cuddle] -> Building visual styling");
	let styleIndex = 0;
	for(const span of completedSpans) {
		styleIndex = (styleIndex + 1) % numStyles;
		for(let lineNumber = span.startLine; lineNumber <= span.endLine; lineNumber++) {
			const isStart = lineNumber == span.startLine;
			const isEnd = lineNumber == span.endLine;
			const splitIndex = isStart || isEnd ? -1 : span.splits.indexOf(lineNumber);
			if (isStart || isEnd || splitIndex != -1) {
				const line = lines[lineNumber];

				let startIndex = 0;
				for(; startIndex < line.length; startIndex++) {
					const char = line.charAt(startIndex)
					if (char !== " " && char !== "\t") {
						break;
					}
				}
				let endIndex = startIndex;

				{
					const openChar = line.charAt(endIndex);
					let closingDelimiter = null;
					for(const delim of DELIMITERS) {
						if (delim.charAt(0) == openChar) {
							closingDelimiter = delim.charAt(1);
							break;
						}
					}
					if (closingDelimiter != null) {
						endIndex++;
						for(; endIndex < line.length; endIndex++) {
							const char = line.charAt(endIndex)
							if (char == closingDelimiter) {
								endIndex++;
								break;
							}
						}
					} else {
						// Best-guess highlighting algorithm
						let isWord = undefined;
						for(; endIndex < line.length; endIndex++) {
							const char = line.charAt(endIndex)
							const isWordChar = char.match(/\w/) !== null;
							if (char === " " || char === "\t") {
								break;
							}
							if (isWord === undefined) {
								isWord = isWordChar;
							} else if (isWordChar !== isWord) {
								break;
							}
						}
					}
				}

				let hoverMessage = undefined;
				if (!isStart) {
					const referenceLine = splitIndex < 1 ? span.startLine : span.splits[splitIndex - 1]
					styleActuals[styleIndex].arm.push({
						range: new vscode.Range(lineNumber, startIndex, lineNumber, endIndex),
						hoverMessage: `\tLine ${referenceLine + 1}: ${lines[referenceLine].trim()}`
					})
				}

				styleActuals[styleIndex].arm.push({
					range: new vscode.Range(lineNumber, startIndex, lineNumber, endIndex),
					hoverMessage: hoverMessage
				})
				
			} else {
				styleActuals[styleIndex].bar.push({
					range: new vscode.Range(lineNumber, 0, lineNumber, 1),
					renderOptions: {
						before: {
							fontWeight: `; left: ${span.column}ch;`
						}
					}
				})
			}
		}
	}
	
	console.log("[cuddle] -> Applying visuals to editor");
	for(let styleIndex = 0; styleIndex < numStyles; styleIndex++) {
		applyIndentStyle(editor, styleDefs[styleIndex], styleActuals[styleIndex]);
	}

	console.log("[cuddle] -> ...all done");
}

export function activate(
	context: vscode.ExtensionContext
) {

	console.log("[cuddle] Activating");
	vscode.window.showInformationMessage("Started cuddle");

	const INDENT_STYLE_DEFS: IndentStyleDef[] = [];
	for(let level = 0; level < 12; level++) {
		INDENT_STYLE_DEFS[level] = createIndentStyleDef(level);
	}

	let activeEditor = vscode.window.activeTextEditor;
	let timeout: NodeJS.Timeout | undefined = undefined;
	function triggerUpdateDecorations(
		throttle: boolean = false
	) {
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		if (throttle) {
			timeout = setTimeout(
				() => {
					if (activeEditor !== undefined) {
						updateDecorations(
							activeEditor,
							INDENT_STYLE_DEFS
						);
					}
				},
				500
			);
		} else {
			if (activeEditor !== undefined) {
				updateDecorations(
					activeEditor,
					INDENT_STYLE_DEFS
				);
			}
		}
	}

	if (activeEditor !== undefined) {
		triggerUpdateDecorations();
	}

	vscode.window.onDidChangeActiveTextEditor(
		editor => {
			activeEditor = editor;
			if (editor !== undefined) {
				triggerUpdateDecorations();
			}
		},
		null,
		context.subscriptions
	);

	vscode.workspace.onDidChangeTextDocument(
		event => {
			if (activeEditor !== undefined && event.document === activeEditor.document) {
				triggerUpdateDecorations();
			}
		},
		null,
		context.subscriptions
	);
}

export function deactivate() {

}
