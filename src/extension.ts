import * as vscode from 'vscode';

type IndentStyleDef = {
	arm: vscode.TextEditorDecorationType,
	bar: vscode.TextEditorDecorationType,
	barHook: vscode.TextEditorDecorationType
}

function createIndentStyleDef(
	level: number
): IndentStyleDef {
	const colour = `var(--vscode-cuddle-highlight-${level + 1})`
	let arm = vscode.window.createTextEditorDecorationType({
		color: colour,
		borderRadius: "2px"
	})
	let bar = vscode.window.createTextEditorDecorationType({
		before: {
			contentText: "|",
			color: "transparent",
			backgroundColor: colour,
			textDecoration: `; position: absolute; width: 2px; height: 100%; top: 0; opacity: 0.25`
		}
	})
	let barHook = vscode.window.createTextEditorDecorationType({
		before: {
			contentText: "|",
			color: "transparent",
			backgroundColor: colour,
			textDecoration: `; position: absolute; width: 2px; height: calc(50% - 1px); top: 0; opacity: 0.25`
		},
		after: {
			contentText: "|",
			color: "transparent",
			backgroundColor: colour,
			textDecoration: `; position: absolute; width: 1ch; height: 2px; top: calc(50% - 1px); opacity: 0.25`
		}
	})
	return {
		arm: arm,
		bar: bar,
		barHook: barHook
	}
}

type IndentStyleActual = {
	arm: vscode.DecorationOptions[],
	bar: vscode.DecorationOptions[],
	barHook: vscode.DecorationOptions[]
}

function createIndentStyleActual(): IndentStyleActual {
	return {
		arm: [],
		bar: [],
		barHook: []
	}
}

function applyIndentStyle(
	editor: vscode.TextEditor,
	definition: IndentStyleDef,
	actual: IndentStyleActual
) {
	editor.setDecorations(definition.arm, actual.arm);
	editor.setDecorations(definition.bar, actual.bar);
	editor.setDecorations(definition.barHook, actual.barHook);
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

type HighlightWholeLine = "never" | "end" | "endAndMiddle" | "always"

type Configuration = {
	detection: {
		requireClosingText: boolean,
		neverStartWith: string[],
		onlyStartWith: string[],
	},
	display: {
		drawConnectingLines: boolean,
		highlightWholeLine: HighlightWholeLine,
		delimiters: string[]
	}
}

function readConfiguration(
	editor: vscode.TextEditor
): Configuration {
	const docConfig = vscode.workspace.getConfiguration("cuddle", editor.document);
	return {
		detection: {
			onlyStartWith: (docConfig.get("detection.onlyStartWith") ?? []) as string[],
			neverStartWith: (docConfig.get("detection.neverStartWith") ?? []) as string[],
			requireClosingText: (docConfig.get("detection.requireClosingText") ?? true) as boolean,
		},
		display: {
			drawConnectingLines: (docConfig.get("display.drawConnectingLines") ?? true) as boolean,
			highlightWholeLine: (docConfig.get("display.highlightWholeLine") ?? "never") as HighlightWholeLine,
			delimiters: (docConfig.get("display.delimiters") ?? []) as string[],
		}
	}
}

function updateDecorations(
	editor: vscode.TextEditor,
	styleDefs: IndentStyleDef[],
	config: Configuration
) {

	const numStyles = styleDefs.length;
	const tabSize = getEditorTabSize(editor);
	const lines = editor.document.getText().split(/\r\n|\r|\n/);
	const numLines = lines.length;
	const styleActuals: IndentStyleActual[] = styleDefs.map(createIndentStyleActual);

	let indentations: number[] = [];
	{
		let numEmpty = 0;
		for(let lineNumber = 0; lineNumber < numLines; lineNumber++) {
			const line = lines[lineNumber];
			if (line.trimEnd().length === 0) {
				// Empty lines don't affect the visual layout of groups. Empty lines adopt the maximum indentation they
				// are surrounded by. For now, this adopts the indentation from above; higher indentation levels from 
				// below will be backfilled later.
				indentations[lineNumber] = 0;
				numEmpty += 1;
			} else {
				const indentation = measureIndentation(line, tabSize);
				indentations[lineNumber] = indentation;
				if (numEmpty > 0) {
					for(let prevLineNumber = lineNumber - numEmpty; prevLineNumber < lineNumber; prevLineNumber++) {
						indentations[prevLineNumber] = Math.max(indentations[prevLineNumber], indentation);
					}
				}
				numEmpty = 0;
			}
		}
	}

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
				isOpening = config.detection.onlyStartWith.length === 0;
				const trimmed = line.trimStart();
				for(const require of config.detection.onlyStartWith) {
					if (trimmed.startsWith(require)) {
						isOpening = true;
						break;
					}
				}
				for(const ignore of config.detection.neverStartWith) {
					if (trimmed.startsWith(ignore)) {
						isOpening = false;
						break;
					}
				}
			}
		}
		if (lineNumber - 1 >= 0) {
			if(config.detection.requireClosingText) {
				if (hasContent) {
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
									completedSpans.push(span);
								}
								break;
							} else if (span.column < thisIndentation) {
								inProgressSpans.push(span); 
								break;
							}
						}
					}
				}
			} else {
				const prevIndentation = indentations[lineNumber - 1];
				if (prevIndentation > thisIndentation) {
					while (true) {
						const span = inProgressSpans.pop();
						if (span === undefined) {
							break;
						} else if (span.column >= thisIndentation) {
							span.endLine = lineNumber - 1;
							completedSpans.push(span);
						} else if (span.column < thisIndentation) {
							inProgressSpans.push(span); 
							break;
						}
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
	if (!config.detection.requireClosingText) {
		while (true) {
			const span = inProgressSpans.pop();
			if (span === undefined) {
				break;
			} else {
				span.endLine = numLines - 1;
				completedSpans.push(span);
			}
		}
	}

	completedSpans.sort((a, b) => a.startLine - b.startLine);

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
				let endIndex = line.length;

				let highlightWholeLine;
				if (config.display.highlightWholeLine === "never") {
					highlightWholeLine = false;
				} else if (config.display.highlightWholeLine === "end") {
					highlightWholeLine = isEnd;
				} else if (config.display.highlightWholeLine === "endAndMiddle") {
					highlightWholeLine = !isStart;
				} else if (config.display.highlightWholeLine === "always") {
					highlightWholeLine = true;
				}

				if (!highlightWholeLine) {
					endIndex = startIndex;
					const openChar = line.charAt(endIndex);
					let closingDelimiters = null;
					for(const delim of config.display.delimiters) {
						if (delim.charAt(0) == openChar) {
							closingDelimiters = delim.substring(1).split("");
							break;
						}
					}
					if (closingDelimiters != null) {
						endIndex++;
						for(; endIndex < line.length; endIndex++) {
							const char = line.charAt(endIndex)
							if (closingDelimiters.includes(char)) {
								endIndex++;
								break;
							}
						}
					} else {
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
					const referenceLine = splitIndex < 1 ? span.startLine : span.splits[splitIndex - 1];
					hoverMessage = `\t${lines[referenceLine].trim()}`;
				}

				if (config.detection.requireClosingText || isStart) {
					styleActuals[styleIndex].arm.push({
						range: new vscode.Range(lineNumber, startIndex, lineNumber, endIndex),
						hoverMessage: hoverMessage
					})
					continue;
				}
			}
			if (config.display.drawConnectingLines) {
				const styleActual = isEnd ? styleActuals[styleIndex].barHook : styleActuals[styleIndex].bar;
				styleActual.push({
					range: new vscode.Range(lineNumber, 0, lineNumber, 1),
					renderOptions: {
						before: {
							fontWeight: `; left: ${span.column}ch;`
						},
						after: {
							fontWeight: `; left: ${span.column}ch;`
						}
					}
				})
			}
		}
	}
	
	for(let styleIndex = 0; styleIndex < numStyles; styleIndex++) {
		applyIndentStyle(editor, styleDefs[styleIndex], styleActuals[styleIndex]);
	}
}

export function activate(
	context: vscode.ExtensionContext
) {
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
							INDENT_STYLE_DEFS,
							readConfiguration(activeEditor)
						);
					}
				},
				500
			);
		} else {
			if (activeEditor !== undefined) {
				updateDecorations(
					activeEditor,
					INDENT_STYLE_DEFS,
					readConfiguration(activeEditor)
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
