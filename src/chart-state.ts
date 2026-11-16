import type {ChartState, DateRange} from "./types";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Local-time YYYY-MM-DD, the format `<input type="date">` uses. */
export function formatDateKey(date: Date): string {
	const y = String(date.getFullYear()).padStart(4, "0");
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

export function startOfDay(key: string): Date {
	return new Date(key + "T00:00:00");
}

export function endOfDay(key: string): Date {
	return new Date(key + "T23:59:59.999");
}

/** The last `days` days, ending today. */
export function rangeForDays(days: number): DateRange {
	const start = new Date();
	start.setDate(start.getDate() - (days - 1));
	start.setHours(0, 0, 0, 0);
	const end = new Date();
	end.setHours(23, 59, 59, 999);
	return {start, end};
}

/**
 * A complete, plausible date from a date input. While a year is being typed the
 * input reports dates like 0002-01-01; those are not a choice yet.
 */
export function isUsableDateKey(key: string): boolean {
	if (!DAY_KEY.test(key)) return false;
	if (parseInt(key.slice(0, 4), 10) < 1900) return false;
	return !isNaN(startOfDay(key).getTime());
}

export interface RestoredRange {
	range: DateRange;
	presetDays: number | null;
}

/** Rebuild the range from saved state, falling back to the default preset. */
export function restoreRange(state: ChartState | null, defaultDays: number): RestoredRange {
	if (state && state.presetDays === null && isUsableDateKey(state.start)) {
		const end = state.end && isUsableDateKey(state.end) ? state.end : formatDateKey(new Date());
		return {range: {start: startOfDay(state.start), end: endOfDay(end)}, presetDays: null};
	}
	const days = state?.presetDays && state.presetDays > 0 ? state.presetDays : defaultDays;
	return {range: rangeForDays(days), presetDays: days};
}

/** The saved form of a range. A hand-picked range that ends today keeps following today. */
export function serializeRange(range: DateRange, presetDays: number | null): Pick<ChartState, "presetDays" | "start" | "end"> {
	const end = formatDateKey(range.end);
	return {
		presetDays,
		start: formatDateKey(range.start),
		end: end === formatDateKey(new Date()) ? null : end,
	};
}
