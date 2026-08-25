import {App, TFile, moment, normalizePath} from "obsidian";
import type {EmilySettings} from "./types";

export type Moment = ReturnType<typeof moment>;

export interface DailyNotesConfig {
	folder: string;
	format: string;
	template: string;
}

interface DailyNotesOptions {
	folder?: string;
	format?: string;
	template?: string;
}

interface AppInternals {
	internalPlugins?: {
		getPluginById?: (id: string) => {
			enabled?: boolean;
			instance?: {options?: DailyNotesOptions};
		} | null;
	};
	plugins?: {
		getPlugin?: (id: string) => {
			settings?: {daily?: DailyNotesOptions};
		} | null;
	};
}

export function getDailyNotesConfig(app: App, settings: EmilySettings): DailyNotesConfig {
	const internals = app as unknown as AppInternals;

	// Try core Daily Notes plugin
	const dailyNotes = internals.internalPlugins?.getPluginById?.("daily-notes");
	if (dailyNotes?.enabled) {
		const opts = dailyNotes.instance?.options;
		if (opts) {
			return {
				folder: opts.folder || settings.dailyNotesFolder,
				format: opts.format || settings.dailyNotesFormat,
				template: opts.template || "",
			};
		}
	}

	// Try Periodic Notes community plugin
	const periodic = internals.plugins?.getPlugin?.("periodic-notes");
	if (periodic) {
		const dailyConfig = periodic.settings?.daily;
		if (dailyConfig) {
			return {
				folder: dailyConfig.folder || settings.dailyNotesFolder,
				format: dailyConfig.format || settings.dailyNotesFormat,
				template: dailyConfig.template || "",
			};
		}
	}

	return {
		folder: settings.dailyNotesFolder,
		format: settings.dailyNotesFormat,
		template: "",
	};
}

/** Vault path (with .md) for the daily note of the given date. */
export function getDailyNotePath(app: App, settings: EmilySettings, date: Moment): string {
	const {folder, format} = getDailyNotesConfig(app, settings);
	const relative = date.format(format) + ".md";
	return normalizePath(folder ? `${folder}/${relative}` : relative);
}

/** The daily note file for the given date, or null if it doesn't exist. */
export function getDailyNoteFile(app: App, settings: EmilySettings, date: Moment): TFile | null {
	const file = app.vault.getAbstractFileByPath(getDailyNotePath(app, settings, date));
	return file instanceof TFile ? file : null;
}

/** Parse a vault path into a "YYYY-MM-DD" key if it's a daily note, else null. */
export function dailyNotePathToDateKey(app: App, settings: EmilySettings, path: string): string | null {
	if (!path.endsWith(".md")) return null;
	const {folder, format} = getDailyNotesConfig(app, settings);
	let datePart: string;
	if (folder) {
		if (!path.startsWith(folder + "/")) return null;
		datePart = path.slice(folder.length + 1, -3);
	} else {
		datePart = path.slice(0, -3);
	}
	const parsed = moment(datePart, format, true);
	return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
}

/** Display name (filename without folders) for the daily note of the given date. */
export function dailyNoteBasename(app: App, settings: EmilySettings, date: Moment): string {
	const {format} = getDailyNotesConfig(app, settings);
	return date.format(format).split("/").pop() ?? date.format("YYYY-MM-DD");
}

/**
 * Create the daily note for the given date, applying the configured template
 * ({{title}}, {{date}}, {{time}}, {{yesterday}}, {{tomorrow}} with optional
 * :FORMAT and +N/-N offsets). Returns the existing file if already present.
 */
export async function createDailyNote(app: App, settings: EmilySettings, date: Moment): Promise<TFile> {
	const path = getDailyNotePath(app, settings, date);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;

	await ensureParentFolders(app, path);

	let content = "";
	const {template, format} = getDailyNotesConfig(app, settings);
	if (template) {
		const templateFile = resolveTemplateFile(app, template);
		if (templateFile) {
			const raw = await app.vault.read(templateFile);
			content = applyTemplate(raw, date, format);
		}
	}

	try {
		return await app.vault.create(path, content);
	} catch (e) {
		// Lost a race with another creator (e.g. sync); use the existing file
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) return file;
		throw e;
	}
}

function resolveTemplateFile(app: App, template: string): TFile | null {
	const byLink = app.metadataCache.getFirstLinkpathDest(template, "");
	if (byLink) return byLink;
	const withExt = template.endsWith(".md") ? template : template + ".md";
	const byPath = app.vault.getAbstractFileByPath(normalizePath(withExt));
	return byPath instanceof TFile ? byPath : null;
}

async function ensureParentFolders(app: App, path: string): Promise<void> {
	const parts = path.split("/").slice(0, -1);
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			try {
				await app.vault.createFolder(current);
			} catch {
				// Folder may have been created concurrently
			}
		}
	}
}

function applyTemplate(raw: string, date: Moment, format: string): string {
	const filename = date.format(format).split("/").pop() ?? "";
	const now = moment();

	return raw
		.replace(/{{\s*title\s*}}/gi, filename)
		.replace(
			/{{\s*(date|time)\s*(?:([+-]\d+)([yqmwdhs]))?\s*(?::(.+?))?\s*}}/gi,
			(_match, kind: string, offset?: string, unit?: string, fmt?: string) => {
				const base = date.clone().set({
					hour: now.hour(),
					minute: now.minute(),
					second: now.second(),
				});
				if (offset && unit) {
					const normalized = unit === "q" ? "Q" : unit;
					base.add(parseInt(offset, 10), normalized as "y" | "Q" | "m" | "w" | "d" | "h" | "s");
				}
				const defaultFmt = kind.toLowerCase() === "time" ? "HH:mm" : "YYYY-MM-DD";
				return base.format(fmt ?? defaultFmt);
			})
		.replace(/{{\s*yesterday\s*(?::(.+?))?\s*}}/gi, (_match, fmt?: string) =>
			date.clone().subtract(1, "day").format(fmt ?? "YYYY-MM-DD"))
		.replace(/{{\s*tomorrow\s*(?::(.+?))?\s*}}/gi, (_match, fmt?: string) =>
			date.clone().add(1, "day").format(fmt ?? "YYYY-MM-DD"));
}
