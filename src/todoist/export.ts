import {TFile, moment, normalizePath} from "obsidian";
import type {App} from "obsidian";
import type {EmilySettings} from "../types";
import type {CompletedTask} from "./api";
import type {Moment} from "../daily-notes";
import {ensureParentFolders} from "../daily-notes";

/**
 * Frontmatter key marking a note as written by this export. Notes without it
 * are left alone, so a hand-written note at the same path is never clobbered.
 */
const MARKER_KEY = "emily-todoist";

/** Heading tasks go under when their project can't be named. */
const UNKNOWN_PROJECT = "Other";

/** Title at the top of every export note, above the per-project headings. */
const TITLE = "# Completed Tasks";

export type WriteResult = "written" | "unchanged" | "empty" | "foreign";

/**
 * Date tokens recognized in the export path. Everything around them is literal
 * text, so a path can be written the obvious way ("Journal/YYYY/YYYY-MM-DD-todoist.md")
 * without every folder name having to be escaped — plain moment.js formatting
 * would turn "Journal" into "Journam9/10/2026". Text that would otherwise read
 * as a token can still be escaped with [square brackets], as in any moment format.
 */
const DATE_TOKEN_RE = /\[[^\]]*\]|Y{4}|Y{2}|M{1,4}|Do|D{1,2}|d{2,4}|Q|W{1,2}|w{1,2}|G{4}|g{4}/g;

/** Apply the date tokens in `format`, leaving everything else verbatim. */
export function formatDatePath(format: string, date: Moment): string {
	let momentFormat = "";
	let last = 0;
	DATE_TOKEN_RE.lastIndex = 0;
	for (let match = DATE_TOKEN_RE.exec(format); match; match = DATE_TOKEN_RE.exec(format)) {
		momentFormat += escapeLiteral(format.slice(last, match.index)) + match[0];
		last = match.index + match[0].length;
	}
	momentFormat += escapeLiteral(format.slice(last));
	return date.format(momentFormat);
}

/** Wrap text so moment emits it as-is. Brackets can't survive, so they're dropped. */
function escapeLiteral(text: string): string {
	return text ? `[${text.replace(/[[\]]/g, "")}]` : "";
}

/** Vault path of the export note for `date`, from the path-format setting. */
export function exportPath(settings: EmilySettings, date: Moment): string {
	const formatted = formatDatePath(settings.todoistFileFormat, date);
	return normalizePath(formatted.endsWith(".md") ? formatted : `${formatted}.md`);
}

/** Local "YYYY-MM-DD" the task was completed on. */
export function completionDateKey(task: CompletedTask): string {
	return moment(task.completedAt).format("YYYY-MM-DD");
}

/** Group tasks into local day buckets, keyed "YYYY-MM-DD". */
export function groupByDay(tasks: CompletedTask[]): Map<string, CompletedTask[]> {
	const days = new Map<string, CompletedTask[]>();
	for (const task of tasks) {
		const key = completionDateKey(task);
		const bucket = days.get(key);
		if (bucket) bucket.push(task);
		else days.set(key, [task]);
	}
	return days;
}

/**
 * The full note body for a day. Deterministic: the same tasks always render
 * the same text, so an unchanged day never rewrites the file.
 */
export function renderExport(
	settings: EmilySettings,
	dateKey: string,
	tasks: CompletedTask[],
	projectNames: Map<string, string>,
): string {
	const sorted = tasks.slice().sort(compareTasks);
	const lines = ["---", `${MARKER_KEY}: true`, `date: ${dateKey}`, "---", "", TITLE, ""];

	if (sorted.length === 0) {
		lines.push("No completed tasks.", "");
		return lines.join("\n");
	}

	if (!settings.todoistGroupByProject) {
		for (const task of sorted) lines.push(taskLine(settings, task));
		lines.push("");
		return lines.join("\n");
	}

	for (const [project, group] of groupByProject(sorted, projectNames)) {
		lines.push(`## ${project}`, "");
		for (const task of group) lines.push(taskLine(settings, task));
		lines.push("");
	}
	return lines.join("\n");
}

/** Project name → its tasks, ordered by project name with "Other" last. */
function groupByProject(
	tasks: CompletedTask[],
	projectNames: Map<string, string>,
): [string, CompletedTask[]][] {
	const groups = new Map<string, CompletedTask[]>();
	for (const task of tasks) {
		const name = projectNames.get(task.projectId) || UNKNOWN_PROJECT;
		const bucket = groups.get(name);
		if (bucket) bucket.push(task);
		else groups.set(name, [task]);
	}
	return Array.from(groups.entries()).sort(([a], [b]) => {
		if (a === UNKNOWN_PROJECT) return b === UNKNOWN_PROJECT ? 0 : 1;
		if (b === UNKNOWN_PROJECT) return -1;
		return a.localeCompare(b);
	});
}

function compareTasks(a: CompletedTask, b: CompletedTask): number {
	if (a.completedAt !== b.completedAt) return a.completedAt < b.completedAt ? -1 : 1;
	// Ties broken by id so pagination order can't shuffle the output
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function taskLine(settings: EmilySettings, task: CompletedTask): string {
	const time = settings.todoistIncludeTime ? `${moment(task.completedAt).format("HH:mm")} ` : "";
	return `- [x] ${time}${flatten(task.content)}`;
}

/** Keep a task on one list item, whatever line breaks its content carries. */
function flatten(text: string): string {
	return text.replace(/\s*\r?\n\s*/g, " ").trim();
}

/**
 * Write `body` to `path`, creating parent folders as needed. An existing note
 * without the marker frontmatter is left untouched, and a day with no tasks
 * only writes when the note already exists (so empty days aren't created).
 */
export async function writeExport(app: App, path: string, body: string, hasTasks: boolean): Promise<WriteResult> {
	const existing = app.vault.getAbstractFileByPath(path);

	if (!(existing instanceof TFile)) {
		if (!hasTasks) return "empty";
		await ensureParentFolders(app, path);
		try {
			await app.vault.create(path, body);
		} catch {
			// Lost a race (sync, or a second refresh of the same day)
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) throw new Error(`Emily: couldn't create ${path}`);
			return rewrite(app, file, body);
		}
		return "written";
	}

	return rewrite(app, existing, body);
}

async function rewrite(app: App, file: TFile, body: string): Promise<WriteResult> {
	const current = await app.vault.read(file);
	if (current.trim() !== "" && !isManaged(current)) return "foreign";
	if (current === body) return "unchanged";
	await app.vault.modify(file, body);
	return "written";
}

/** True when the note's leading frontmatter carries the export marker. */
function isManaged(content: string): boolean {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(content);
	if (!frontmatter) return false;
	return new RegExp(`^${MARKER_KEY}:\\s*true\\s*$`, "m").test(frontmatter[1] ?? "");
}
