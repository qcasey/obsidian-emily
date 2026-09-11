import {Notice, moment} from "obsidian";
import type EmilyPlugin from "../main";
import type {CompletedTask} from "./api";
import {MAX_RANGE_DAYS, TodoistApiError, fetchCompletedTasks, fetchProjects} from "./api";
import {exportPath, groupByDay, renderExport, writeExport} from "./export";
import type {WriteResult} from "./export";

/** How long today's export stays fresh before reopening the note refetches it. */
const TODAY_COOLDOWN_MS = 10 * 60_000;

/** Project names change rarely; re-read them at most this often. */
const PROJECTS_TTL_MS = 60 * 60_000;

/** Floor between error notices, so one bad token can't spam a scrolling journal. */
const NOTICE_INTERVAL_MS = 60_000;

export interface BackfillProgress {
	/** Days resolved so far, out of `total`. */
	done: number;
	total: number;
	written: number;
}

export interface BackfillSummary extends BackfillProgress {
	skipped: number;
}

/**
 * Keeps the per-day Todoist export notes up to date.
 *
 * Days are refreshed lazily — opening a daily note (or scrolling its section
 * into the infinite journal) fetches that one day. Requests are serialized and
 * de-duplicated so a journal rendering a week's worth of sections still makes
 * one request per day, at most.
 */
export class TodoistService {
	private queue: Promise<unknown> = Promise.resolve();
	private fetched = new Map<string, number>();
	private projectNames = new Map<string, string>();
	private projectsFetchedAt = 0;
	private lastNoticeAt = 0;
	private backfilling = false;
	/** Set when Todoist rejects the token, so a scrolling journal stops retrying. */
	private authFailed = false;

	constructor(private plugin: EmilyPlugin) {}

	get enabled(): boolean {
		const {todoistEnabled, todoistApiToken} = this.plugin.settings;
		return todoistEnabled && todoistApiToken.trim() !== "";
	}

	/** Drop cached freshness so the next open refetches (settings changed). */
	reset(): void {
		this.fetched.clear();
		this.projectNames.clear();
		this.projectsFetchedAt = 0;
		this.lastNoticeAt = 0;
		this.authFailed = false;
	}

	/**
	 * Refresh the export note for one day, unless it was already fetched
	 * recently. `force` bypasses every freshness check.
	 */
	refreshDay(dateKey: string, force = false): Promise<void> {
		// An explicit refresh is also a retry after a rejected token
		if (force) this.authFailed = false;
		if (!this.enabled || this.backfilling || this.authFailed) return Promise.resolve();
		if (!force && !this.needsRefresh(dateKey)) return Promise.resolve();

		// Future days can't have completions yet
		if (dateKey > moment().format("YYYY-MM-DD")) return Promise.resolve();

		this.fetched.set(dateKey, Date.now());
		return this.enqueue(async () => {
			try {
				await this.exportDay(dateKey);
			} catch (e) {
				this.fetched.delete(dateKey);
				this.reportError(e);
			}
		});
	}

	/**
	 * One-time catch-up: export every day from `sinceKey` through today.
	 * Fetches in multi-day chunks rather than one request per day.
	 */
	async backfill(sinceKey: string, onProgress?: (p: BackfillProgress) => void): Promise<BackfillSummary> {
		if (!this.enabled) throw new Error("Todoist export is off or has no API token");
		if (this.backfilling) throw new Error("A Todoist backfill is already running");
		this.authFailed = false;

		const start = moment(sinceKey, "YYYY-MM-DD", true);
		if (!start.isValid()) throw new Error(`"${sinceKey}" isn't a YYYY-MM-DD date`);
		const today = moment().startOf("day");
		if (start.isAfter(today, "day")) throw new Error("The backfill date is in the future");

		this.backfilling = true;
		try {
			const total = today.diff(start, "days") + 1;
			const summary: BackfillSummary = {done: 0, total, written: 0, skipped: 0};
			const names = await this.projects();

			const chunkStart = start.clone();
			while (chunkStart.isSameOrBefore(today, "day")) {
				const chunkEnd = moment.min(chunkStart.clone().add(MAX_RANGE_DAYS - 1, "days"), today);
				const tasks = await fetchCompletedTasks(
					this.plugin.settings.todoistApiToken.trim(),
					utcBound(chunkStart),
					utcBound(chunkEnd.clone().add(1, "day")),
				);
				const byDay = groupByDay(tasks);

				const day = chunkStart.clone();
				while (day.isSameOrBefore(chunkEnd, "day")) {
					const dateKey = day.format("YYYY-MM-DD");
					const result = await this.writeDay(dateKey, byDay.get(dateKey) ?? [], names);
					if (result === "written") summary.written++;
					if (result === "foreign") summary.skipped++;
					this.fetched.set(dateKey, Date.now());
					summary.done++;
					day.add(1, "day");
				}

				onProgress?.({done: summary.done, total, written: summary.written});
				chunkStart.add(MAX_RANGE_DAYS, "days");
			}

			return summary;
		} finally {
			this.backfilling = false;
		}
	}

	private needsRefresh(dateKey: string): boolean {
		const last = this.fetched.get(dateKey);
		if (dateKey === moment().format("YYYY-MM-DD")) {
			return last === undefined || Date.now() - last > TODAY_COOLDOWN_MS;
		}
		if (last !== undefined) return false;
		// A past day's completions don't change, so an existing export stands
		const path = exportPath(this.plugin.settings, moment(dateKey, "YYYY-MM-DD"));
		if (this.plugin.app.vault.getAbstractFileByPath(path)) {
			this.fetched.set(dateKey, Date.now());
			return false;
		}
		return true;
	}

	private async exportDay(dateKey: string): Promise<void> {
		const day = moment(dateKey, "YYYY-MM-DD", true);
		if (!day.isValid()) return;

		const tasks = await fetchCompletedTasks(
			this.plugin.settings.todoistApiToken.trim(),
			utcBound(day.clone().startOf("day")),
			utcBound(day.clone().startOf("day").add(1, "day")),
		);
		// The window is built from local midnights, but group anyway so a task
		// completed on a boundary always lands on the day it belongs to
		const forDay = groupByDay(tasks).get(dateKey) ?? [];
		await this.writeDay(dateKey, forDay, await this.projects());
	}

	private async writeDay(
		dateKey: string,
		tasks: CompletedTask[],
		names: Map<string, string>,
	): Promise<WriteResult> {
		const {app, settings} = this.plugin;
		const path = exportPath(settings, moment(dateKey, "YYYY-MM-DD"));
		const body = renderExport(settings, dateKey, tasks, names);
		const result = await writeExport(app, path, body, tasks.length > 0);
		if (result === "foreign") {
			console.warn(`Emily: ${path} wasn't written by the Todoist export; leaving it alone`);
		}
		return result;
	}

	/** Project id → name, cached. Empty when grouping is off (nothing needs it). */
	private async projects(): Promise<Map<string, string>> {
		if (!this.plugin.settings.todoistGroupByProject) return new Map();
		if (this.projectNames.size > 0 && Date.now() - this.projectsFetchedAt < PROJECTS_TTL_MS) {
			return this.projectNames;
		}
		this.projectNames = await fetchProjects(this.plugin.settings.todoistApiToken.trim());
		this.projectsFetchedAt = Date.now();
		return this.projectNames;
	}

	/** Run `task` after everything already queued, so requests don't overlap. */
	private enqueue(task: () => Promise<void>): Promise<void> {
		const run = this.queue.then(task, task);
		this.queue = run;
		return run;
	}

	private reportError(e: unknown): void {
		// A rejected token won't fix itself; stop until the settings change
		if (e instanceof TodoistApiError && (e.status === 401 || e.status === 403)) {
			this.authFailed = true;
		}
		console.error("Emily: Todoist export failed", e);
		if (Date.now() - this.lastNoticeAt < NOTICE_INTERVAL_MS) return;
		this.lastNoticeAt = Date.now();
		const message = e instanceof TodoistApiError ? e.message : "Todoist export failed; see the console";
		new Notice(`Emily: ${message}`);
	}
}

/** A local moment as the UTC instant the API expects, e.g. `2026-09-10T07:00:00Z`. */
function utcBound(date: ReturnType<typeof moment>): string {
	return date.clone().utc().format("YYYY-MM-DDTHH:mm:ss[Z]");
}
