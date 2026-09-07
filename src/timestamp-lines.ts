import {EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate} from "@codemirror/view";
import {RangeSetBuilder} from "@codemirror/state";
import {editorInfoField} from "obsidian";

/** A line that begins with a `HH:MM` timestamp (leading whitespace allowed). */
const TIMESTAMP_LINE_RE = /^\s*(\d{1,2}:\d{2})(?=\s|$)/;

/** Every timestamp line gets this class. */
const LINE_CLASS = "emily-timestamp-line";
/** Additionally set on the first line of a run sharing the same timestamp. */
const GROUP_START_CLASS = "emily-timestamp-group-start";
/** Wraps the HH:MM text itself. */
const STAMP_CLASS = "emily-timestamp";

const lineDeco = Decoration.line({class: LINE_CLASS});
const groupStartDeco = Decoration.line({class: `${LINE_CLASS} ${GROUP_START_CLASS}`});
const stampDeco = Decoration.mark({class: STAMP_CLASS});

/** Normalize a folder setting like "Journal/" to "Journal/" (or "" for the vault root). */
function normalizeFolder(folder: string): string {
	const trimmed = folder.trim().replace(/^\/+|\/+$/g, "");
	return trimmed ? `${trimmed}/` : "";
}

/** Path of the file the editor is showing, or undefined if none is attached yet. */
function filePath(view: EditorView): string | undefined {
	return view.state.field(editorInfoField, false)?.file?.path;
}

/**
 * Does the file belong under the configured folder? An editor with no file
 * attached yet (which happens briefly while Obsidian is opening a note) is
 * treated as a daily note so the decorations are present on the first paint;
 * `update` removes them once the file is known.
 */
function isInFolder(path: string | undefined, folder: string): boolean {
	if (!path) return true;
	const prefix = normalizeFolder(folder);
	return prefix === "" || path.startsWith(prefix);
}

function buildDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;

	for (const {from, to} of view.visibleRanges) {
		let pos = from;
		while (pos <= to) {
			const line = doc.lineAt(pos);
			const match = TIMESTAMP_LINE_RE.exec(line.text);
			if (match) {
				const prevText = line.number > 1 ? doc.line(line.number - 1).text : "";
				const prevMatch = TIMESTAMP_LINE_RE.exec(prevText);
				const startsGroup = !prevMatch || prevMatch[1] !== match[1];
				builder.add(line.from, line.from, startsGroup ? groupStartDeco : lineDeco);
				const stamp = match[1]!;
				const stampStart = line.from + match[0].length - stamp.length;
				builder.add(stampStart, stampStart + stamp.length, stampDeco);
			}
			if (line.to >= doc.length) break;
			pos = line.to + 1;
		}
	}

	return builder.finish();
}

/**
 * Tags editor lines that start with a timestamp so CSS can style them
 * (for example, adding vertical spacing between journal entries), and wraps
 * the timestamp text itself so it can be rendered in a monospace font.
 * Only active for files under the daily notes folder.
 */
export function timestampLinesPlugin(folder: () => string) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private path: string | undefined;

			constructor(view: EditorView) {
				this.path = filePath(view);
				this.decorations = isInFolder(this.path, folder()) ? buildDecorations(view) : Decoration.none;
			}

			update(update: ViewUpdate) {
				const path = filePath(update.view);
				const fileChanged = path !== this.path;
				this.path = path;
				if (!isInFolder(path, folder())) {
					this.decorations = Decoration.none;
					return;
				}
				if (update.docChanged || update.viewportChanged || fileChanged || this.decorations === Decoration.none) {
					this.decorations = buildDecorations(update.view);
				}
			}
		},
		{decorations: (v) => v.decorations},
	);
}
