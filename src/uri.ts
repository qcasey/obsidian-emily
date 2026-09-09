import {MarkdownView, Notice, TFile, moment, normalizePath} from "obsidian";
import type {App, ObsidianProtocolData} from "obsidian";
import type EmilyPlugin from "./main";
import {createDailyNote} from "./daily-notes";
import {createPlaceNote, findNearestPlace, parseLatLng} from "./places";

/**
 * Delays (ms) at which the editor is re-focused after opening. On mobile the
 * editor view is often still being attached when the handler runs, especially
 * on a cold launch, and a single `focus()` call goes nowhere.
 */
const FOCUS_RETRY_DELAYS = [0, 100, 300, 700, 1500];

/**
 * `obsidian://emily?daily=true&mode=append&data=...`
 *
 * Opens today's daily note (or `filepath=`), appends `data` on a new line,
 * puts the cursor at the end of the note, and focuses the editor so the
 * keyboard comes up on mobile. Parameters:
 *
 * - `daily=true`      target today's daily note, creating it if needed
 * - `filepath=...`    target this vault path instead (".md" optional)
 * - `mode=append`     append `data` on a new line (default); `open` ignores `data`
 * - `data=...`        URL-encoded text to append
 * - `heading=...`     append at the end of this section instead of the end of
 *                     the note. Leading `#`s are optional ("Locations" and
 *                     "# Locations" both work). The section runs until the next
 *                     heading of the same or higher level; text goes after its
 *                     last non-blank line so a trailing blank line is kept. A
 *                     heading that isn't in the note is created at the end.
 *
 * Logging a place, e.g. from a Shortcut that knows where the phone is:
 *
 * - `place=...`          name of the place, as reverse-geocoding reported it
 * - `coordinates=lat,lng` where the phone was
 *
 * If a note in the places folder has coordinates within the snap radius, that
 * note is logged instead of `place` (so a strip-mall storefront next to
 * Ralph's becomes Ralph's). Otherwise a new place note is created with the
 * coordinates. Either way `HH:MM [[Place]]` is appended under `heading`,
 * which defaults to the places heading setting, with `data` after the link
 * if given.
 */
export function registerEmilyUriHandler(plugin: EmilyPlugin): void {
	plugin.registerObsidianProtocolHandler("emily", (params) => {
		plugin.app.workspace.onLayoutReady(() => {
			void handle(plugin, params).catch((e: unknown) => {
				console.error("Emily URI handler failed", e);
				new Notice("Emily: couldn't open the note");
			});
		});
	});
}

async function handle(plugin: EmilyPlugin, params: ObsidianProtocolData): Promise<void> {
	const {app, settings} = plugin;
	const file = await resolveTarget(app, plugin, params);
	if (!file) {
		new Notice("Emily: no note to open");
		return;
	}

	const leaf = app.workspace.getLeaf(false);
	await leaf.openFile(file, {active: true, state: {mode: "source"}});
	const view = leaf.view instanceof MarkdownView ? leaf.view : app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) return;

	const editor = view.editor;
	const mode = params.mode ?? "append";
	let data = params.data ?? "";
	let headingParam = params.heading;
	const point = parseLatLng(params.coordinates);
	if (point) {
		const placeFile = await resolvePlace(plugin, params.place ?? "", point);
		data = `${timestampNow()} [[${placeFile.basename}]]${data ? ` ${data}` : ""}`;
		headingParam ??= settings.placesHeading;
	}
	if (mode === "append" && data) {
		const heading = parseHeadingParam(headingParam);
		const anchor = heading ? findSectionEnd(editor, heading) : null;
		if (heading && !anchor) {
			// Section missing: create it at the end, then append beneath it
			appendAt(editor, editor.lastLine(), settings.insertBlankLine, `${"#".repeat(heading.level)} ${heading.text}`);
		}
		const line = anchor ?? editor.lastLine();
		const end = appendAt(editor, line, settings.insertBlankLine, data);
		editor.setCursor(end);
	} else {
		moveCursorToEnd(editor);
	}

	focusEditor(plugin, view);
}

/**
 * The place note to log for a fix at `point`: a known note within the snap
 * radius wins over the reported name, otherwise a note named `name` is created.
 */
async function resolvePlace(plugin: EmilyPlugin, name: string, point: {lat: number; lng: number}): Promise<TFile> {
	const {app, settings} = plugin;
	const match = findNearestPlace(app, settings, point);
	if (match) {
		if (name && name !== match.file.basename) {
			new Notice(`Emily: logged ${match.file.basename} (${Math.round(match.distance)} m away) instead of ${name}`);
		}
		return match.file;
	}
	const file = await createPlaceNote(app, settings, name, point);
	new Notice(`Emily: new place ${file.basename}`);
	return file;
}

function timestampNow(): string {
	const now = new Date();
	return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

interface HeadingSpec {
	text: string;
	/** 1-6; used only when the heading has to be created */
	level: number;
}

/** `"# Locations"` → `{text: "Locations", level: 1}`; `"Locations"` → level 1 too. */
function parseHeadingParam(raw: string | undefined): HeadingSpec | null {
	if (!raw) return null;
	const m = /^\s*(#{0,6})\s*(.*?)\s*$/.exec(raw);
	const text = m?.[2] ?? "";
	if (!text) return null;
	return {text, level: Math.max(1, m?.[1]?.length ?? 0)};
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/**
 * Line number of the last non-blank line in the section under `heading`, or
 * the heading line itself when the section is empty. `null` if the heading
 * isn't in the note. Headings inside fenced code blocks are ignored.
 */
function findSectionEnd(editor: MarkdownView["editor"], heading: HeadingSpec): number | null {
	const want = heading.text.toLowerCase();
	let inFence = false;
	let level = 0;
	let end: number | null = null;
	for (let i = 0; i <= editor.lastLine(); i++) {
		const text = editor.getLine(i);
		if (/^\s*(```|~~~)/.test(text)) inFence = !inFence;
		if (inFence) {
			if (end !== null) end = i;
			continue;
		}
		const m = HEADING_RE.exec(text);
		if (m) {
			const thisLevel = m[1]!.length;
			if (end !== null && thisLevel <= level) return end;
			if (end === null && m[2]!.toLowerCase() === want) {
				level = thisLevel;
				end = i;
			}
			continue;
		}
		if (end !== null && text.trim() !== "") end = i;
	}
	return end;
}

/**
 * Insert `text` on a new line after `line`, separated by a blank line when the
 * setting asks for one and there isn't one already. Returns the end position
 * of the inserted text.
 */
function appendAt(editor: MarkdownView["editor"], line: number, blankLine: boolean, text: string): {line: number; ch: number} {
	const lineText = editor.getLine(line);
	let prefix = "";
	if (lineText.trim() !== "") {
		prefix = blankLine ? "\n\n" : "\n";
	} else if (blankLine && line > 0 && editor.getLine(line - 1).trim() !== "") {
		prefix = "\n";
	}
	editor.replaceRange(prefix + text, {line, ch: lineText.length});
	const inserted = (prefix + text).split("\n");
	const endLine = line + inserted.length - 1;
	const endCh = inserted.length === 1 ? lineText.length + text.length : inserted[inserted.length - 1]!.length;
	return {line: endLine, ch: endCh};
}

async function resolveTarget(app: App, plugin: EmilyPlugin, params: ObsidianProtocolData): Promise<TFile | null> {
	if (params.filepath) {
		// Obsidian has already URL-decoded the parameters
		const raw = params.filepath;
		const path = normalizePath(raw.endsWith(".md") ? raw : `${raw}.md`);
		const existing = app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		return app.vault.create(path, "");
	}
	// `daily=true` or nothing at all both mean today's daily note
	return createDailyNote(app, plugin.settings, moment());
}

function moveCursorToEnd(editor: MarkdownView["editor"]): void {
	const lastLine = editor.lastLine();
	editor.setCursor({line: lastLine, ch: editor.getLine(lastLine).length});
}

/**
 * Focus the editor now and again over the next second or so. Any attempt that
 * lands after the view is attached wins; the extra calls are harmless once
 * the editor already has focus.
 */
function focusEditor(plugin: EmilyPlugin, view: MarkdownView): void {
	const attempt = () => {
		if (plugin.app.workspace.getActiveViewOfType(MarkdownView) !== view) return;
		view.editor.focus();
	};
	for (const delay of FOCUS_RETRY_DELAYS) {
		window.setTimeout(attempt, delay);
	}
}
