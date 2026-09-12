import type {Editor} from "obsidian";
import {canonicalFeeling} from "./feelings-data";

/**
 * Mark the selection as a feeling by wrapping it in braces — `happy` becomes
 * `{Happy}`, the way `[[…]]` marks a link. Names the wheel knows are spelled
 * the wheel's way, so the highlighting and the charts see the same word;
 * anything else is wrapped as typed. Whitespace at either end of the
 * selection is left outside the braces. A selection that is already braced
 * (whether or not the braces themselves are selected) is unwrapped instead, so
 * the same button toggles.
 *
 * Returns false when there's nothing selected, leaving the caller to fall back
 * to the wheel.
 */
export function toggleFeelingBraces(editor: Editor): boolean {
	const selection = editor.getSelection();
	const core = selection.trim();
	if (!core) return false;

	const lead = selection.slice(0, selection.length - selection.trimStart().length);
	const trail = selection.slice(selection.trimEnd().length);

	let start = editor.posToOffset(editor.getCursor("from"));
	let end = editor.posToOffset(editor.getCursor("to"));
	let text: string;
	if (core.length > 1 && core.startsWith("{") && core.endsWith("}")) {
		text = lead + core.slice(1, -1) + trail;
	} else if (charAt(editor, start - 1) === "{" && charAt(editor, end) === "}") {
		// The braces are just outside the selection; take them with it
		start -= 1;
		end += 1;
		text = selection;
	} else {
		text = `${lead}{${canonicalize(core)}}${trail}`;
	}

	editor.replaceRange(text, editor.offsetToPos(start), editor.offsetToPos(end));
	editor.setSelection(editor.offsetToPos(start), editor.offsetToPos(start + text.length));
	return true;
}

/** The single character at `offset`, or "" past either end of the note. */
function charAt(editor: Editor, offset: number): string {
	if (offset < 0) return "";
	return editor.getRange(editor.offsetToPos(offset), editor.offsetToPos(offset + 1));
}

/**
 * Respell each comma-separated name the way the wheel spells it, leaving
 * names the wheel doesn't know — and the spacing around them — untouched.
 */
function canonicalize(feelings: string): string {
	return feelings
		.split(",")
		.map((part) => {
			const name = part.trim();
			const canonical = name ? canonicalFeeling(name) : null;
			return canonical ? part.replace(name, canonical) : part;
		})
		.join(",");
}
