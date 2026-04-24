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
	narrationInheritMinutes: number;
	frequencySuggestEnabled: boolean;
	defaultEnabledGroup: string;
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
	showWheelSettingsIcon: boolean;
}

export const DEFAULT_SETTINGS: EmilySettings = {
	dailyNotesFolder: "",
	dailyNotesFormat: "YYYY-MM-DD",
	defaultDateRangeDays: 7,
	logSectionHeading: "Log",
	autoEmbed: true,
	autoEmbedTopics: "",
	narrationInheritMinutes: 0,
	frequencySuggestEnabled: true,
	defaultEnabledGroup: "mood",
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
	showWheelSettingsIcon: true,
};

export function hashTopicColor(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
	}
	const hue = ((hash % 360) + 360) % 360;
	return `hsl(${hue}, 65%, 55%)`;
}
