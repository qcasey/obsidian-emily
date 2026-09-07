import {EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate} from "@codemirror/view";
import {RangeSetBuilder} from "@codemirror/state";
import type {EditorSelection} from "@codemirror/state";
import {editorInfoField} from "obsidian";

/** A line that begins with a `HH:MM` timestamp (leading whitespace allowed). */
const TIMESTAMP_LINE_RE = /^\s*(\d{1,2}:\d{2})(?=\s|$)/;

/** Every timestamp line gets this class. */
const LINE_CLASS = "emily-timestamp-line";
/** Additionally set on the first line of a run sharing the same timestamp. */
const GROUP_START_CLASS = "emily-timestamp-group-start";
/** Wraps the HH:MM text itself. */
const STAMP_CLASS = "emily-timestamp";
/**
 * Set on the HH:MM span to the 12-hour time ("2:35") and its period ("pm").
 * CSS draws the raw text transparent and overlays these values via
 * `content: attr(...)`: the time right-aligned onto the raw text, the period
 * as a small badge at its bottom-right corner. The document and the line's
 * width are untouched.
 */
const TWELVE_HOUR_ATTR = "data-emily-12h";
const PERIOD_ATTR = "data-emily-12h-period";

const lineDeco = Decoration.line({class: LINE_CLASS});
const groupStartDeco = Decoration.line({class: `${LINE_CLASS} ${GROUP_START_CLASS}`});
const stampDeco = Decoration.mark({class: STAMP_CLASS});

/** One decoration per distinct 12-hour string (at most 1440), reused across rebuilds. */
const twelveHourDecos = new Map<string, Decoration>();

/** "14:35" → {time: "2:35", period: "pm"}, "00:05" → {time: "12:05", period: "am"}. Undefined if out of range. */
export function toTwelveHour(stamp: string): {time: string; period: "am" | "pm"} | undefined {
	const [h, m] = stamp.split(":");
	const hours = Number(h);
	const minutes = Number(m);
	if (hours > 23 || minutes > 59) return undefined;
	const hour12 = hours % 12 || 12;
	return {time: `${hour12}:${m}`, period: hours < 12 ? "am" : "pm"};
}

function twelveHourDeco(stamp: string): Decoration {
	const parsed = toTwelveHour(stamp);
	if (!parsed) return stampDeco;
	const key = `${parsed.time} ${parsed.period}`;
	let deco = twelveHourDecos.get(key);
	if (!deco) {
		deco = Decoration.mark({
			class: STAMP_CLASS,
			attributes: {[TWELVE_HOUR_ATTR]: parsed.time, [PERIOD_ATTR]: parsed.period},
		});
		twelveHourDecos.set(key, deco);
	}
	return deco;
}

/** Is the cursor (or a selection) on or touching the range? */
function selectionTouches(selection: EditorSelection, from: number, to: number): boolean {
	return selection.ranges.some(r => r.from <= to && r.to >= from);
}

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

function buildDecorations(view: EditorView, twelveHour: boolean): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;
	const selection = view.state.selection;

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
				const stampEnd = stampStart + stamp.length;
				// Show the raw HH:MM while it's being edited so typing isn't blind
				const overlay = twelveHour && !selectionTouches(selection, stampStart, stampEnd);
				builder.add(stampStart, stampEnd, overlay ? twelveHourDeco(stamp) : stampDeco);
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
 * the timestamp text itself so it can be rendered in a monospace font and,
 * when `twelveHour` is on, displayed as a 12-hour time without touching the
 * document. Only active for files under the daily notes folder.
 */
export function timestampLinesPlugin(folder: () => string, twelveHour: () => boolean) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private path: string | undefined;
			private twelveHour: boolean;

			constructor(view: EditorView) {
				this.path = filePath(view);
				this.twelveHour = twelveHour();
				this.decorations = isInFolder(this.path, folder()) ? buildDecorations(view, this.twelveHour) : Decoration.none;
			}

			update(update: ViewUpdate) {
				const path = filePath(update.view);
				const fileChanged = path !== this.path;
				this.path = path;
				const settingChanged = twelveHour() !== this.twelveHour;
				this.twelveHour = twelveHour();
				if (!isInFolder(path, folder())) {
					this.decorations = Decoration.none;
					return;
				}
				// selectionSet matters because the 12-hour overlay lifts while the cursor is on a timestamp
				const selectionMatters = this.twelveHour && update.selectionSet;
				if (update.docChanged || update.viewportChanged || selectionMatters || fileChanged || settingChanged
					|| this.decorations === Decoration.none) {
					this.decorations = buildDecorations(update.view, this.twelveHour);
				}
			}
		},
		{decorations: (v) => v.decorations},
	);
}
