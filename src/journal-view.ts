import {App, Component, ItemView, MarkdownRenderer, TFile, WorkspaceLeaf, moment} from "obsidian";
import type EmilyPlugin from "./main";
import {
	createDailyNote,
	dailyNoteBasename,
	dailyNotePathToDateKey,
	getDailyNoteFile,
} from "./daily-notes";
import type {Moment} from "./daily-notes";

export const VIEW_TYPE_JOURNAL = "emily-journal";

const INITIAL_PAST_DAYS = 4;
const INITIAL_FUTURE_DAYS = 3;
const BATCH_DAYS = 7;
const SCROLL_THRESHOLD = 300;

/** Minimal shape of Obsidian's internal editable markdown embed (WidgetEditorView). */
interface EmbeddedEditor extends Component {
	editable?: boolean;
	loadFile?: () => Promise<void>;
	showEditor?: () => void;
	editMode?: {
		editor?: {
			focus?: () => void;
			lastLine?: () => number;
			getLine?: (line: number) => string | undefined;
			setCursor?: (pos: {line: number; ch: number}) => void;
		};
	};
}

type EmbedCreator = (
	context: {app: App; containerEl: HTMLElement; state?: unknown},
	file: TFile,
	subpath: string,
) => EmbeddedEditor | null;

interface EmbedRegistryInternals {
	embedRegistry?: {
		embedByExtension?: Record<string, EmbedCreator | undefined>;
	};
}

interface DaySection {
	dateKey: string; // YYYY-MM-DD
	el: HTMLElement;
	titleEl: HTMLElement;
	subtitleEl: HTMLElement;
	contentEl: HTMLElement;
	file: TFile | null;
	component: Component | null;
	creating: boolean;
}

export class JournalView extends ItemView {
	private plugin: EmilyPlugin;
	private daysEl: HTMLElement;
	private sections: DaySection[] = []; // chronological, oldest first
	private firstDate: Moment;
	private lastDate: Moment;
	private extending = false;
	private todayKey: string;

	constructor(leaf: WorkspaceLeaf, plugin: EmilyPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.todayKey = moment().format("YYYY-MM-DD");
	}

	getViewType(): string {
		return VIEW_TYPE_JOURNAL;
	}

	getDisplayText(): string {
		return "Journal";
	}

	getIcon(): string {
		return "book-open";
	}

	async onOpen(): Promise<void> {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass("emily-journal-view");

		this.daysEl = contentEl.createEl("div", {cls: "emily-journal-days"});

		await this.resetAroundToday(false);

		this.registerDomEvent(contentEl, "scroll", () => this.onScroll());

		this.registerEvent(this.app.vault.on("create", (file) => this.handlePathChange(file.path)));
		this.registerEvent(this.app.vault.on("delete", (file) => this.handlePathChange(file.path)));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
			this.handlePathChange(oldPath);
			this.handlePathChange(file.path);
		}));

		// Refresh headers when the day rolls over
		this.registerInterval(window.setInterval(() => {
			const key = moment().format("YYYY-MM-DD");
			if (key !== this.todayKey) {
				this.todayKey = key;
				this.refreshHeaders();
			}
		}, 60_000));
	}

	async onClose(): Promise<void> {
		this.clearSections();
	}

	/** Re-apply header labels (used when the relative-dates setting changes). */
	public refreshHeaders(): void {
		for (const section of this.sections) {
			this.applyHeader(section);
		}
	}

	public scrollToToday(smooth = true): void {
		const section = this.sections.find(s => s.dateKey === this.todayKey);
		if (!section) {
			// Window drifted away from today; rebuild around it
			void this.resetAroundToday(false);
			return;
		}
		section.el.scrollIntoView({behavior: smooth ? "smooth" : "auto", block: "start"});
	}

	private async resetAroundToday(smooth: boolean): Promise<void> {
		this.extending = true;
		try {
			this.clearSections();
			this.todayKey = moment().format("YYYY-MM-DD");
			const today = moment().startOf("day");
			this.firstDate = today.clone().subtract(INITIAL_PAST_DAYS, "days");
			this.lastDate = today.clone().add(INITIAL_FUTURE_DAYS, "days");

			const loads: Promise<void>[] = [];
			const day = this.firstDate.clone();
			while (day.isSameOrBefore(this.lastDate, "day")) {
				const section = this.buildSection(day.clone());
				this.daysEl.appendChild(section.el);
				this.sections.push(section);
				loads.push(this.populateSection(section));
				day.add(1, "day");
			}
			await Promise.all(loads);
		} finally {
			this.extending = false;
		}
		this.scrollToToday(smooth);
	}

	private clearSections(): void {
		for (const section of this.sections) {
			if (section.component) this.removeChild(section.component);
		}
		this.sections = [];
		this.daysEl.empty();
	}

	// ---- Infinite scroll ----

	private onScroll(): void {
		if (this.extending) return;
		const el = this.contentEl;
		if (el.scrollTop < SCROLL_THRESHOLD) {
			void this.extendPast();
		} else if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD) {
			void this.extendFuture();
		}
	}

	private async extendPast(): Promise<void> {
		this.extending = true;
		try {
			const el = this.contentEl;
			const newSections: DaySection[] = [];
			const start = this.firstDate.clone().subtract(BATCH_DAYS, "days");
			const day = this.firstDate.clone().subtract(1, "day");

			// Insert newest-first so each goes above the previous top
			const heightBefore = el.scrollHeight;
			const topBefore = el.scrollTop;
			while (day.isSameOrAfter(start, "day")) {
				const section = this.buildSection(day.clone());
				this.daysEl.insertBefore(section.el, this.daysEl.firstChild);
				newSections.unshift(section);
				day.subtract(1, "day");
			}
			// Keep the viewport anchored after the synchronous insert
			el.scrollTop = topBefore + (el.scrollHeight - heightBefore);
			this.firstDate = start;
			this.sections.unshift(...newSections);

			const heightAfterInsert = el.scrollHeight;
			await Promise.all(newSections.map(s => this.populateSection(s)));
			// Compensate for async height growth above the viewport
			el.scrollTop += el.scrollHeight - heightAfterInsert;
		} finally {
			this.extending = false;
		}
	}

	private async extendFuture(): Promise<void> {
		this.extending = true;
		try {
			const end = this.lastDate.clone().add(BATCH_DAYS, "days");
			const day = this.lastDate.clone().add(1, "day");
			const newSections: DaySection[] = [];
			while (day.isSameOrBefore(end, "day")) {
				const section = this.buildSection(day.clone());
				this.daysEl.appendChild(section.el);
				newSections.push(section);
				day.add(1, "day");
			}
			this.lastDate = end;
			this.sections.push(...newSections);
			await Promise.all(newSections.map(s => this.populateSection(s)));
		} finally {
			this.extending = false;
		}
	}

	// ---- Day sections ----

	private buildSection(date: Moment): DaySection {
		const el = document.createElement("div");
		el.addClass("emily-journal-day");
		const dateKey = date.format("YYYY-MM-DD");
		el.dataset.date = dateKey;

		const header = el.createEl("div", {cls: "emily-journal-header"});
		const titleEl = header.createEl("span", {cls: "emily-journal-title"});
		const subtitleEl = header.createEl("span", {cls: "emily-journal-subtitle"});
		const contentEl = el.createEl("div", {cls: "emily-journal-content"});

		const section: DaySection = {dateKey, el, titleEl, subtitleEl, contentEl, file: null, component: null, creating: false};

		header.addEventListener("click", () => {
			if (!section.file) void this.createNote(section);
		});

		this.applyHeader(section);
		return section;
	}

	private applyHeader(section: DaySection): void {
		const date = moment(section.dateKey, "YYYY-MM-DD");
		const basename = dailyNoteBasename(this.app, this.plugin.settings, date);

		if (this.plugin.settings.journalRelativeDates) {
			section.titleEl.setText(this.relativeLabel(date));
			section.subtitleEl.setText(basename);
		} else {
			section.titleEl.setText(basename);
			section.subtitleEl.setText("");
		}

		section.el.toggleClass("emily-journal-today", section.dateKey === this.todayKey);
	}

	private relativeLabel(date: Moment): string {
		const today = moment(this.todayKey, "YYYY-MM-DD");
		const days = date.diff(today, "days");
		if (days === 0) return "Today";
		if (days === -1) return "Yesterday";
		if (days === 1) return "Tomorrow";
		if (days < 0 && days >= -6) return "Last " + date.format("dddd");
		if (days > 1 && days <= 6) return date.format("dddd");
		return date.format(date.year() === today.year() ? "MMMM Do" : "MMMM Do, YYYY");
	}

	private async populateSection(section: DaySection): Promise<void> {
		const date = moment(section.dateKey, "YYYY-MM-DD");
		const file = getDailyNoteFile(this.app, this.plugin.settings, date);
		if (file) {
			await this.attachFile(section, file);
		} else {
			this.renderPlaceholder(section);
		}
	}

	private renderPlaceholder(section: DaySection): void {
		section.el.addClass("emily-journal-missing");
		section.contentEl.empty();
		const placeholder = section.contentEl.createEl("div", {cls: "emily-journal-placeholder"});
		placeholder.addEventListener("click", () => {
			if (!section.file) void this.createNote(section);
		});
	}

	private async createNote(section: DaySection): Promise<void> {
		if (section.creating || section.file) return;
		section.creating = true;
		try {
			const date = moment(section.dateKey, "YYYY-MM-DD");
			const file = await createDailyNote(this.app, this.plugin.settings, date);
			await this.attachFile(section, file, true);
		} catch (e) {
			console.error("Emily journal: failed to create daily note", e);
		} finally {
			section.creating = false;
		}
	}

	private async attachFile(section: DaySection, file: TFile, focus = false): Promise<void> {
		if (section.file) return;
		section.file = file;
		section.el.removeClass("emily-journal-missing");
		section.contentEl.empty();

		const mounted = await this.mountEditor(section, file);
		if (!mounted) await this.mountPreview(section, file);
		if (focus) this.focusSection(section);
	}

	private detachFile(section: DaySection): void {
		if (section.component) {
			this.removeChild(section.component);
			section.component = null;
		}
		section.file = null;
		this.renderPlaceholder(section);
	}

	/**
	 * Mount an editable embedded markdown editor (same mechanism Canvas uses
	 * for editable file embeds). Uses internal APIs, so it degrades to a
	 * rendered preview if anything is missing.
	 */
	private async mountEditor(section: DaySection, file: TFile): Promise<boolean> {
		try {
			const registry = this.app as unknown as EmbedRegistryInternals;
			const creator = registry.embedRegistry?.embedByExtension?.["md"];
			if (typeof creator !== "function") return false;

			const widget = creator(
				{app: this.app, containerEl: section.contentEl, state: {}},
				file,
				"",
			);
			if (!widget) return false;

			widget.editable = true;
			this.addChild(widget);
			await widget.loadFile?.();
			widget.showEditor?.();
			section.component = widget;
			return true;
		} catch (e) {
			console.error("Emily journal: embedded editor failed, falling back to preview", e);
			section.contentEl.empty();
			return false;
		}
	}

	/** Read-only fallback: rendered markdown (code block processors still run). */
	private async mountPreview(section: DaySection, file: TFile): Promise<void> {
		section.contentEl.empty();
		const component = new Component();
		this.addChild(component);
		section.component = component;

		const previewEl = section.contentEl.createEl("div", {cls: "emily-journal-preview"});
		const content = await this.app.vault.cachedRead(file);
		await MarkdownRenderer.render(this.app, content, previewEl, file.path, component);

		previewEl.addEventListener("dblclick", () => {
			void this.app.workspace.getLeaf("tab").openFile(file);
		});
	}

	private focusSection(section: DaySection): void {
		try {
			const editor = (section.component as EmbeddedEditor | null)?.editMode?.editor;
			if (editor) {
				editor.focus?.();
				const lastLine = editor.lastLine?.();
				if (typeof lastLine === "number") {
					editor.setCursor?.({line: lastLine, ch: editor.getLine?.(lastLine)?.length ?? 0});
				}
				return;
			}
		} catch {
			// fall through to DOM focus
		}
		section.contentEl.querySelector<HTMLElement>(".cm-content")?.focus();
	}

	// ---- Vault sync ----

	private handlePathChange(path: string): void {
		const dateKey = dailyNotePathToDateKey(this.app, this.plugin.settings, path);
		if (!dateKey) return;
		const section = this.sections.find(s => s.dateKey === dateKey);
		// While `creating` is set, the click handler owns attaching the file
		// (so the new editor gets focused); ignore the vault create event.
		if (!section || section.creating) return;

		const file = getDailyNoteFile(this.app, this.plugin.settings, moment(dateKey, "YYYY-MM-DD"));
		if (file && !section.file) {
			void this.attachFile(section, file);
		} else if (!file && section.file) {
			this.detachFile(section);
		}
	}
}
