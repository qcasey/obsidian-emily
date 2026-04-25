import {EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate} from "@codemirror/view";
import {RangeSetBuilder} from "@codemirror/state";
import {FEELINGS_WHEEL, buildFlatSegments} from "./feelings-data";

/** Build a case-insensitive label → color lookup from the feelings wheel */
function buildColorMap(): Map<string, string> {
	const map = new Map<string, string>();
	const {core, secondary, tertiary} = buildFlatSegments();
	for (const seg of [...core, ...secondary, ...tertiary]) {
		map.set(seg.label.toLowerCase(), seg.color);
	}
	return map;
}

const COLOR_MAP = buildColorMap();

/** Regex to find `{...}` blocks (non-greedy, single line) */
const BRACE_RE = /\{([^}]+)\}/g;

function buildDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();

	for (const {from, to} of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to);
		BRACE_RE.lastIndex = 0;

		let match: RegExpExecArray | null;
		while ((match = BRACE_RE.exec(text)) !== null) {
			const inner = match[1]!;
			const feelings = inner.split(",").map(s => s.trim()).filter(Boolean);

			// Only decorate if at least one feeling matches the wheel
			const matched = feelings.filter(f => COLOR_MAP.has(f.toLowerCase()));
			if (matched.length === 0) continue;

			// Find each individual feeling within the braces and decorate it
			const braceStart = from + match.index;
			const innerStart = braceStart + 1; // skip opening {
			const innerText = inner;

			for (const feeling of matched) {
				const color = COLOR_MAP.get(feeling.toLowerCase())!;
				// Find this feeling's position within the inner text
				const idx = findFeeling(innerText, feeling);
				if (idx === -1) continue;

				const deco = Decoration.mark({
					attributes: {
						style: `color: ${color};`,
						class: "emily-feeling-hl",
					},
				});

				builder.add(innerStart + idx, innerStart + idx + feeling.length, deco);
			}
		}
	}

	return builder.finish();
}

/** Find exact feeling name in inner text (case-insensitive match at word boundaries) */
function findFeeling(innerText: string, feeling: string): number {
	const lower = innerText.toLowerCase();
	const target = feeling.toLowerCase();
	let searchFrom = 0;
	while (true) {
		const idx = lower.indexOf(target, searchFrom);
		if (idx === -1) return -1;
		// Verify it's a standalone word (bounded by start/end/comma/space)
		const before = idx === 0 || /[\s,{]/.test(innerText[idx - 1]!);
		const after = idx + target.length >= innerText.length || /[\s,}]/.test(innerText[idx + target.length]!);
		if (before && after) return idx;
		searchFrom = idx + 1;
	}
}

export function feelingsHighlightPlugin(enabled: () => boolean) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = enabled() ? buildDecorations(view) : Decoration.none;
			}

			update(update: ViewUpdate) {
				if (!enabled()) {
					this.decorations = Decoration.none;
					return;
				}
				if (update.docChanged || update.viewportChanged) {
					this.decorations = buildDecorations(update.view);
				}
			}
		},
		{decorations: (v) => v.decorations},
	);
}
