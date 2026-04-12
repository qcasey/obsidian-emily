import type {TrackingEntry} from "./types";

const ENTRY_REGEX = /^(\d{2}:\d{2})\s+\[\[([^\]]+)\]\]\s+(-?\d+(?:\.\d+)?)\s*(.*)$/;

export function parseLogEntries(
	content: string,
	date: string,
	sourceFile: string,
	logHeading: string,
): TrackingEntry[] {
	const lines = content.split("\n");
	const entries: TrackingEntry[] = [];

	let inLogSection = false;
	const headingPattern = new RegExp(`^#{1,6}\\s+${escapeRegex(logHeading)}\\s*$`);

	for (const line of lines) {
		if (headingPattern.test(line)) {
			inLogSection = true;
			continue;
		}

		if (inLogSection && /^#{1,6}\s+/.test(line)) {
			break;
		}

		if (!inLogSection) continue;

		const match = line.match(ENTRY_REGEX);
		if (!match) continue;

		const [, time, rawTopic, valueStr, narration] = match;
		// Handle [[Target|Alias]] — use Target, discard Alias
		const topic = (rawTopic as string).split("|")[0] as string;
		const value = parseFloat(valueStr as string);

		const [hours, minutes] = (time as string).split(":").map(Number);
		const [year, month, day] = date.split("-").map(Number);
		const timestamp = new Date(year as number, (month as number) - 1, day, hours, minutes).getTime();

		entries.push({
			date,
			time: time as string,
			timestamp,
			topic: topic as string,
			value,
			narration: (narration as string).trim(),
			sourceFile,
		});
	}

	return entries;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
