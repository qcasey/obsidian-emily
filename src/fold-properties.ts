import {App, MarkdownView, TFile} from "obsidian";

interface FoldRange {
	from: number;
	to: number;
}

interface FoldInfo {
	folds: FoldRange[];
	lines: number;
}

interface FoldManager {
	load(file: TFile | null): FoldInfo | null;
}

/** Obsidian records collapsed properties as a fold that starts at line 0. */
const PROPERTIES_FOLD: FoldRange = {from: 0, to: 0};

function hasFrontmatter(app: App, file: TFile): boolean {
	return app.metadataCache.getFileCache(file)?.frontmatterPosition !== undefined;
}

/** Line count of the file as currently loaded in an editor, or 0 if none is open. */
function lineCount(app: App, file: TFile): number {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file === file) return view.editor.lineCount();
	}
	return 0;
}

/**
 * Wraps Obsidian's fold manager so notes with frontmatter open with their
 * properties collapsed.
 *
 * While loading a file, Obsidian reads the stored folds synchronously and
 * collapses the metadata editor before anything is painted. Injecting the
 * properties fold at that point means the note is never drawn expanded, unlike
 * folding after `file-open`, which shows the properties for a moment first.
 *
 * Returns a function that restores the original fold manager.
 */
export function patchFoldManager(app: App, enabled: () => boolean): () => void {
	const manager = (app as App & {foldManager: FoldManager}).foldManager;
	// Captured unbound on purpose: it is invoked below with the manager as `this`.
	// eslint-disable-next-line @typescript-eslint/unbound-method
	const original = manager.load;

	manager.load = function (file) {
		const info = original.call(this, file);
		if (!enabled() || !file || !hasFrontmatter(app, file)) return info;
		if (info?.folds.some((fold) => fold.from === 0)) return info;
		return {
			folds: [PROPERTIES_FOLD, ...(info?.folds ?? [])],
			lines: info?.lines ?? lineCount(app, file),
		};
	};

	return () => {
		if (manager.load !== original) manager.load = original;
	};
}
