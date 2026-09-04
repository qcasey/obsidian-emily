import {EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate} from "@codemirror/view";
import {RangeSetBuilder} from "@codemirror/state";
import {editorInfoField} from "obsidian";

/** A line that begins with a `HH:MM` timestamp (leading whitespace allowed). */
const TIMESTAMP_LINE_RE = /^\s*(\d{1,2}:\d{2})(?=\s|$)/;

/** Every timestamp line gets this class. */
const LINE_CLASS = "emily-timestamp-line";
/** Additionally set on the first line of a run sharing the same timestamp. */
const GROUP_START_CLASS = "emily-timestamp-group-start";

const lineDeco = Decoration.line({class: LINE_CLASS});
const groupStartDeco = Decoration.line({class: `${LINE_CLASS} ${GROUP_START_CLASS}`});

/** Normalize a folder setting like "Journal/" to "Journal/" (or "" for the vault root). */
function normalizeFolder(folder: string): string {
	const trimmed = folder.trim().replace(/^\/+|\/+$/g, "");
	return trimmed ? `${trimmed}/` : "";
}

/** Does the editor belong to a file under the configured folder? */
function isInFolder(view: EditorView, folder: string): boolean {
	const info = view.state.field(editorInfoField, false);
	const path = info?.file?.path;
	if (!path) return false;
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
			}
			if (line.to >= doc.length) break;
			pos = line.to + 1;
		}
	}

	return builder.finish();
}

/**
 * Tags editor lines that start with a timestamp so CSS snippets can style
 * them (for example, adding vertical spacing between journal entries).
 * Only active for files under the daily notes folder.
 */
export function timestampLinesPlugin(folder: () => string) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = isInFolder(view, folder()) ? buildDecorations(view) : Decoration.none;
			}

			update(update: ViewUpdate) {
				if (!isInFolder(update.view, folder())) {
					this.decorations = Decoration.none;
					return;
				}
				if (update.docChanged || update.viewportChanged || this.decorations === Decoration.none) {
					this.decorations = buildDecorations(update.view);
				}
			}
		},
		{decorations: (v) => v.decorations},
	);
}
