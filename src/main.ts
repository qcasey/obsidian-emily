import {Editor, MarkdownView, Plugin, WorkspaceLeaf, debounce} from "obsidian";
import {DEFAULT_SETTINGS} from "./types";
import type {EmilySettings} from "./types";
import {EmilySettingTab} from "./settings";
import {TrackingView, VIEW_TYPE_EMILY} from "./view";
import {renderEmbed} from "./embed";
import {DataService} from "./data-service";
import {FrequencyLinkSort} from "./suggest";
import {FeelingsOverlay} from "./feelings-overlay";

export default class EmilyPlugin extends Plugin {
	settings: EmilySettings;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_EMILY, (leaf) => new TrackingView(leaf, this));

		this.addRibbonIcon("line-chart", "Open Emily tracker", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-tracking-chart",
			name: "Open tracking chart",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "insert-timestamp-link",
			name: "Insert timestamp and link",
			icon: "clock",
			editorCallback: (editor: Editor) => {
				const cursor = editor.getCursor();
				const currentLine = editor.getLine(cursor.line);
				const prevLine = cursor.line > 0 ? editor.getLine(cursor.line - 1) : "";

				let prefix = "";
				if (currentLine.trim() !== "") {
					prefix = "\n\n";
				} else if (prevLine.trim() !== "") {
					prefix = "\n";
				}

				const now = new Date();
				const hh = String(now.getHours()).padStart(2, "0");
				const mm = String(now.getMinutes()).padStart(2, "0");
				const text = `${prefix}${hh}:${mm} [[`;

				editor.replaceRange(text, cursor);
				const insertedLines = text.split("\n");
				const lastLine = insertedLines[insertedLines.length - 1] as string;
				const newLine = cursor.line + insertedLines.length - 1;
				const newCh = (insertedLines.length === 1 ? cursor.ch : 0) + lastLine.length;
				editor.setCursor({line: newLine, ch: newCh});
			},
		});

		this.addCommand({
			id: "show-feelings-wheel",
			name: "Show feelings wheel",
			icon: "heart",
			editorCallback: (editor: Editor) => {
				const overlay = new FeelingsOverlay(
					editor,
					(emotions) => {
						const text = emotions.join(", ");
						const cursor = editor.getCursor();
						editor.replaceRange(text, cursor);
						const newCh = cursor.ch + text.length;
						editor.setCursor({line: cursor.line, ch: newCh});
					},
					() => { /* cancelled */ },
					this.settings.feelingsWheelZoom,
					this.settings.feelingsWheel3d,
					{
						k: this.settings.rolodexK,
						floor: this.settings.rolodexFloor,
						peak: this.settings.rolodexPeak,
						resolution: this.settings.rolodexResolution,
						snap: this.settings.rolodexSnap,
					},
					{
						snap: this.settings.feelingsWheelSnap,
						friction: this.settings.feelingsWheelFriction,
						maxSpeed: this.settings.feelingsWheelMaxSpeed,
					},
				);
				overlay.open();
			},
		});

		this.addCommand({
			id: "export-csv",
			name: "Export current view as CSV",
			checkCallback: (checking) => {
				const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_EMILY);
				if (leaves.length > 0) {
					if (!checking) {
						(leaves[0]?.view as TrackingView).exportCsv();
					}
					return true;
				}
				return false;
			},
		});

		this.addSettingTab(new EmilySettingTab(this.app, this));

		const freqSort = new FrequencyLinkSort(this.app, this);
		// Patch after layout is ready so the native suggest is registered
		this.app.workspace.onLayoutReady(() => {
			freqSort.patchNativeSuggest();
		});
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => {
				freqSort.rebuildFrequencyCache();
			})
		);

		this.registerMarkdownCodeBlockProcessor("emily", (source, el, ctx) => {
			renderEmbed(source, el, this.app, this.settings);
		});

		// Auto-embed on daily notes
		const dataService = new DataService(this.app, this.settings);
		this.registerEvent(
			this.app.workspace.on("file-open", debounce((file) => {
				if (!this.settings.autoEmbed || !file) return;
				if (!dataService.isDailyNote(file.path)) return;
				this.injectAutoEmbed(file.path);
			}, 300, true))
		);

		// Also re-inject when switching between edit/preview
		this.registerEvent(
			this.app.workspace.on("layout-change", debounce(() => {
				if (!this.settings.autoEmbed) return;
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) return;
				if (!dataService.isDailyNote(view.file.path)) return;
				this.injectAutoEmbed(view.file.path);
			}, 500, true))
		);
	}

	private injectAutoEmbed(filePath: string): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file || view.file.path !== filePath) return;

		const contentEl = view.contentEl;
		// Don't double-inject
		if (contentEl.querySelector(".emily-auto-embed")) return;

		const topics = this.settings.autoEmbedTopics
			? `topics: ${this.settings.autoEmbedTopics}`
			: "";

		const container = contentEl.createEl("div", {cls: "emily-auto-embed emily-embed"});
		container.style.position = "relative";
		renderEmbed(`days: 1\n${topics}\nlegend: true`, container, this.app, this.settings);
	}

	async activateView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_EMILY);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0] as WorkspaceLeaf);
			return;
		}

		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({type: VIEW_TYPE_EMILY, active: true});
		this.app.workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<EmilySettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
