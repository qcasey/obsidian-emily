import type {App} from "obsidian";
import type EmilyPlugin from "./main";

export class FrequencyLinkSort {
	private frequencyCache = new Map<string, number>();
	private patched = false;

	constructor(
		private app: App,
		private plugin: EmilyPlugin,
	) {
		this.rebuildFrequencyCache();
	}

	patchNativeSuggest(): void {
		if (this.patched) return;

		const suggests = (this.app.workspace as any).editorSuggest?.suggests as any[] | undefined;
		if (!suggests) return;

		// Find the native link suggest (the one that triggers on [[)
		const nativeSuggest = suggests.find(
			(s: any) => s.constructor?.name === "EditorSuggest" || s.getSuggestions?.toString?.()?.includes?.("getLinkSuggestions"),
		) ?? suggests[0];

		if (!nativeSuggest || !nativeSuggest.getSuggestions) return;

		const original = nativeSuggest.getSuggestions.bind(nativeSuggest);
		const self = this;

		nativeSuggest.getSuggestions = function (context: any) {
			const results = original(context);

			if (!self.plugin.settings.frequencySuggestEnabled) return results;

			const query = context?.query ?? "";
			const isTimestamp = self.isTimestampContext(context);

			// Handle both sync and async results
			if (results instanceof Promise) {
				return results.then((items: any[]) => self.sortByFrequency(items, query, isTimestamp));
			}
			return self.sortByFrequency(results, query, isTimestamp);
		};

		this.patched = true;
	}

	private isTimestampContext(context: any): boolean {
		try {
			const editor = context?.editor;
			const start = context?.start;
			if (!editor || !start) return false;
			const line = editor.getLine(start.line);
			const before = line.slice(0, start.ch);
			return /\d{2}:\d{2}\s+\[\[$/.test(before);
		} catch {
			return false;
		}
	}

	private sortByFrequency(items: any[], query: string, isTimestamp: boolean): any[] {
		if (!items?.length) return items;

		// No query — sort entirely by frequency
		if (!query) {
			return items.sort((a: any, b: any) => {
				return this.getFrequency(b) - this.getFrequency(a);
			});
		}

		// With a query — the native suggest already filtered to matching items.
		// Separate into tiers, then sort by frequency within each tier.
		// In timestamp context: title matches > alias matches > substring matches
		// Otherwise: starts-with (title or alias) > substring matches
		const q = query.toLowerCase();
		const titleMatch: any[] = [];
		const aliasMatch: any[] = [];
		const contains: any[] = [];

		for (const item of items) {
			const isAliasItem = !!item?.alias;
			const name = (item?.file?.basename ?? item?.basename ?? "").toLowerCase();

			if (isTimestamp && isAliasItem) {
				// In timestamp context, alias items are demoted to their own tier
				aliasMatch.push(item);
			} else if (name.startsWith(q)) {
				titleMatch.push(item);
			} else {
				contains.push(item);
			}
		}

		const byFreq = (a: any, b: any) => this.getFrequency(b) - this.getFrequency(a);
		titleMatch.sort(byFreq);
		aliasMatch.sort(byFreq);
		contains.sort(byFreq);

		return [...titleMatch, ...aliasMatch, ...contains];
	}

	private getFrequency(item: any): number {
		// Native suggest items have a `file` property (TFile) or a `path` string
		const path = item?.file?.path ?? item?.path ?? "";
		if (!path) return 0;
		return this.frequencyCache.get(path) ?? 0;
	}

	rebuildFrequencyCache(): void {
		this.frequencyCache.clear();
		const resolved = this.app.metadataCache.resolvedLinks;
		for (const sourcePath in resolved) {
			const links = resolved[sourcePath];
			if (!links) continue;
			for (const destPath in links) {
				const count = links[destPath] ?? 0;
				this.frequencyCache.set(
					destPath,
					(this.frequencyCache.get(destPath) ?? 0) + count,
				);
			}
		}
	}
}
