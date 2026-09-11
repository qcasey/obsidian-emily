import {requestUrl} from "obsidian";

const API_BASE = "https://api.todoist.com/api/v1";

/** Page size for the paginated endpoints. The API defaults to 50. */
const PAGE_LIMIT = 200;

/** Stops a malformed `next_cursor` chain from looping forever. */
const MAX_PAGES = 200;

/**
 * Longest completion-date window the API accepts is three months; stay well
 * inside it so month lengths and time zones can't push a request over.
 */
export const MAX_RANGE_DAYS = 60;

/** A task as returned by the completed-tasks endpoint, trimmed to what we render. */
export interface CompletedTask {
	id: string;
	content: string;
	projectId: string;
	/** ISO 8601 UTC instant the task was checked off. */
	completedAt: string;
}

export interface TodoistProject {
	id: string;
	name: string;
}

export class TodoistApiError extends Error {
	constructor(message: string, readonly status?: number) {
		super(message);
		this.name = "TodoistApiError";
	}
}

interface ItemSyncView {
	id?: unknown;
	content?: unknown;
	project_id?: unknown;
	completed_at?: unknown;
}

interface CompletedResponse {
	items?: ItemSyncView[];
	next_cursor?: string | null;
}

interface ProjectsResponse {
	results?: {id?: unknown; name?: unknown}[];
	next_cursor?: string | null;
}

/**
 * Completed tasks in `[since, until)`, following pagination to the end.
 * Both bounds are ISO 8601 instants (e.g. `2026-09-10T07:00:00Z`).
 */
export async function fetchCompletedTasks(
	token: string,
	since: string,
	until: string,
): Promise<CompletedTask[]> {
	const tasks: CompletedTask[] = [];
	let cursor: string | undefined;

	for (let page = 0; page < MAX_PAGES; page++) {
		const params: Record<string, string> = {since, until, limit: String(PAGE_LIMIT)};
		if (cursor) params.cursor = cursor;

		const body = await get<CompletedResponse>(token, "/tasks/completed/by_completion_date", params);
		for (const item of body.items ?? []) {
			const task = toTask(item);
			if (task) tasks.push(task);
		}

		if (!body.next_cursor) return tasks;
		cursor = body.next_cursor;
	}

	throw new TodoistApiError("Todoist returned more pages of completed tasks than expected");
}

/** Project id → name, for grouping the export. */
export async function fetchProjects(token: string): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	let cursor: string | undefined;

	for (let page = 0; page < MAX_PAGES; page++) {
		const params: Record<string, string> = {limit: String(PAGE_LIMIT)};
		if (cursor) params.cursor = cursor;

		const body = await get<ProjectsResponse>(token, "/projects", params);
		for (const project of body.results ?? []) {
			if (typeof project.id === "string" && typeof project.name === "string") {
				names.set(project.id, project.name);
			}
		}

		if (!body.next_cursor) return names;
		cursor = body.next_cursor;
	}

	throw new TodoistApiError("Todoist returned more pages of projects than expected");
}

function toTask(item: ItemSyncView): CompletedTask | null {
	if (typeof item.id !== "string" || typeof item.content !== "string") return null;
	if (typeof item.completed_at !== "string" || !item.completed_at) return null;
	return {
		id: item.id,
		content: item.content,
		projectId: typeof item.project_id === "string" ? item.project_id : "",
		completedAt: item.completed_at,
	};
}

/**
 * `requestUrl` rather than `fetch` so the request isn't subject to the
 * renderer's CORS rules and works the same on mobile.
 */
async function get<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
	const query = new URLSearchParams(params).toString();
	const response = await requestUrl({
		url: `${API_BASE}${path}?${query}`,
		method: "GET",
		headers: {Authorization: `Bearer ${token}`},
		// Read the status ourselves so the message can name the cause
		throw: false,
	});

	if (response.status === 401 || response.status === 403) {
		throw new TodoistApiError("Todoist rejected the API token", response.status);
	}
	if (response.status === 429) {
		throw new TodoistApiError("Todoist rate limit reached; try again later", response.status);
	}
	if (response.status >= 400) {
		throw new TodoistApiError(`Todoist API returned ${response.status}`, response.status);
	}

	try {
		return response.json as T;
	} catch {
		throw new TodoistApiError("Todoist returned a response that wasn't JSON", response.status);
	}
}
