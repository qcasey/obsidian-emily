import {MarkdownView, Notice, TFile, moment, normalizePath} from "obsidian";
import type {App, ObsidianProtocolData} from "obsidian";
import type EmilyPlugin from "./main";
import {createDailyNote} from "./daily-notes";

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
	const data = params.data ?? "";
	if (mode === "append" && data) {
		const lastLine = editor.lastLine();
		const lastText = editor.getLine(lastLine);
		let prefix = "";
		if (lastText.trim() !== "") {
			prefix = settings.insertBlankLine ? "\n\n" : "\n";
		} else if (settings.insertBlankLine && lastLine > 0 && editor.getLine(lastLine - 1).trim() !== "") {
			prefix = "\n";
		}
		editor.replaceRange(prefix + data, {line: lastLine, ch: lastText.length});
	}

	moveCursorToEnd(editor);
	focusEditor(plugin, view);
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
