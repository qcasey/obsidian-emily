export interface TrackingEntry {
	date: string;
	time: string;
	timestamp: number;
	topic: string;
	value: number;
	narration: string;
	sourceFile: string;
}

export interface TopicConfig {
	color: string;
	enabled: boolean;
	visibleDefault: boolean;
	displayType: "range" | "spike" | "spike_full";
	unit: string;
	max: number | null;
	min: number | null;
	subtle: boolean;
	subtleOpacity: number;
	group: string[];
	aggregate: "none" | "sum" | "average";
	heatmapGradient: boolean;
}

export interface ResolvedTopic {
	name: string;
	config: TopicConfig;
	entries: TrackingEntry[];
	historicalMax: number;
}

export const DEFAULT_SCALE_MAX = 10;

export interface DateRange {
	start: Date;
	end: Date;
}

export interface EmilySettings {
	dailyNotesFolder: string;
	dailyNotesFormat: string;
	defaultDateRangeDays: number;
	logSectionHeading: string;
	autoEmbed: boolean;
	autoEmbedTopics: string;
	insertBetweenBraces: boolean;
	/** Leave a blank line before an inserted timestamp instead of just starting a new line. */
	insertBlankLine: boolean;
	narrationInheritMinutes: number;
	frequencySuggestEnabled: boolean;
	/** After picking a `[[link]]` suggestion on a log line (`HH:MM [[link]]`), insert a space so the value can be typed right away. */
	spaceAfterLogLink: boolean;
	defaultEnabledGroup: string;
	/** Folder holding one note per place, each with a `coordinates` property. */
	placesFolder: string;
	/** Heading that `place=` URI logs go under when the URI doesn't say. */
	placesHeading: string;
	/** A logged place within this many meters of a known place note is treated as that place. */
	placeSnapMeters: number;
	feelingsWheelZoom: number;
	feelingsWheel3d: "off" | "opacity" | "size";
	rolodexK: number;
	rolodexFloor: number;
	rolodexPeak: number;
	rolodexResolution: number;
	feelingsWheelReach: number;
	feelingsWheelSnap: number;
	feelingsWheelFriction: number;
	rolodexSnap: number;
	rolodexFontScale: number;
	rolodexFontCeiling: number;
	rolodexWeightScale: number;
	showWheelSettingsIcon: boolean;
	feelingsHighlight: boolean;
	/** Extra vertical padding (em) above and below timestamped journal lines. */
	timestampLineGap: number;
	/** Render the HH:MM timestamp at the start of journal lines in a monospace font. */
	timestampMonospace: boolean;
	/** Render the HH:MM timestamp in the muted text color. */
	timestampMuted: boolean;
	/** Display (not rewrite) HH:MM timestamps as 12-hour times, right-aligned over the original text. */
	timestampTwelveHour: boolean;
	/** Open notes with their properties collapsed. */
	foldPropertiesByDefault: boolean;
	infiniteJournal: boolean;
	journalRelativeDates: boolean;
	journalReplaceDailyNote: boolean;
	/** Export the day's completed Todoist tasks to a note when that day is opened. */
	todoistEnabled: boolean;
	/** Todoist API token, stored in the plugin's data.json in plain text. */
	todoistApiToken: string;
	/** Vault path of the export note, with date tokens like YYYY-MM-DD. */
	todoistFileFormat: string;
	/** Put the exported tasks under a heading per Todoist project. */
	todoistGroupByProject: boolean;
	/** Prefix each exported task with the time it was completed. */
	todoistIncludeTime: boolean;
	/** Earliest date the one-time backfill reaches back to (YYYY-MM-DD). */
	todoistBackfillSince: string;
}

export const DEFAULT_SETTINGS: EmilySettings = {
	dailyNotesFolder: "",
	dailyNotesFormat: "YYYY-MM-DD",
	defaultDateRangeDays: 7,
	logSectionHeading: "Log",
	autoEmbed: true,
	autoEmbedTopics: "",
	insertBetweenBraces: true,
	insertBlankLine: false,
	narrationInheritMinutes: 0,
	frequencySuggestEnabled: true,
	spaceAfterLogLink: true,
	defaultEnabledGroup: "mood",
	placesFolder: "Locations",
	placesHeading: "Locations",
	placeSnapMeters: 150,
	feelingsWheelZoom: 50,
	feelingsWheel3d: "off",
	rolodexK: 40,
	rolodexFloor: 0.06,
	rolodexPeak: 0.2,
	rolodexResolution: 1024,
	feelingsWheelReach: 0.95,
	feelingsWheelSnap: 0.08,
	feelingsWheelFriction: 0.92,
	rolodexSnap: 0.02,
	rolodexFontScale: 0.5,
	rolodexFontCeiling: 0.8,
	rolodexWeightScale: 0.5,
	showWheelSettingsIcon: true,
	feelingsHighlight: true,
	timestampLineGap: 0.75,
	timestampMonospace: true,
	timestampMuted: false,
	timestampTwelveHour: true,
	foldPropertiesByDefault: false,
	infiniteJournal: true,
	journalRelativeDates: true,
	journalReplaceDailyNote: true,
	todoistEnabled: false,
	todoistApiToken: "",
	todoistFileFormat: "Journal/YYYY/YYYY-MM-DD-todoist.md",
	todoistGroupByProject: true,
	todoistIncludeTime: true,
	todoistBackfillSince: "",
};

export function hashTopicColor(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
	}
	const hue = ((hash % 360) + 360) % 360;
	return `hsl(${hue}, 65%, 55%)`;
}
