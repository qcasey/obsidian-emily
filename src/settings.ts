import {App, PluginSettingTab, Setting} from "obsidian";
import type EmilyPlugin from "./main";
import {DEFAULT_SETTINGS} from "./types";
import type {EmilySettings} from "./types";

export class EmilySettingTab extends PluginSettingTab {
	plugin: EmilyPlugin;

	constructor(app: App, plugin: EmilyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		this.displayDailyNotes(containerEl);
		this.displayLogEntries(containerEl);
		this.displayEditorAppearance(containerEl);
		this.displayInfiniteJournal(containerEl);
		this.displayTrackingChart(containerEl);
		this.displayPlaces(containerEl);
		this.displayFeelingsWheel(containerEl);
	}

	private displayPlaces(containerEl: HTMLElement): void {
		this.heading(containerEl, "Places");

		new Setting(containerEl)
			.setName("Places folder")
			.setDesc("Folder of place notes, one per location, each with a coordinates property (lat, lng). Used by the emily://…&place=&coordinates= URI")
			.addText(text => text
				.setPlaceholder("Locations")
				.setValue(this.plugin.settings.placesFolder)
				.onChange(async (value) => {
					this.plugin.settings.placesFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Places heading")
			.setDesc("Heading in the daily note that place logs go under when the URI doesn't specify one")
			.addText(text => text
				.setPlaceholder("Locations")
				.setValue(this.plugin.settings.placesHeading)
				.onChange(async (value) => {
					this.plugin.settings.placesHeading = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Snap radius")
			.setDesc("A logged location within this many meters of a known place note is recorded as that place, whatever name the phone reported (0 = always use the reported name)")
			.addText(text => text
				.setPlaceholder("150")
				.setValue(String(this.plugin.settings.placeSnapMeters))
				.onChange(async (value) => {
					const num = parseInt(value, 10);
					this.plugin.settings.placeSnapMeters = isNaN(num) ? 0 : Math.max(0, num);
					await this.plugin.saveSettings();
				}));
	}

	private heading(containerEl: HTMLElement, text: string): void {
		new Setting(containerEl).setName(text).setHeading();
	}

	private displayDailyNotes(containerEl: HTMLElement): void {
		this.heading(containerEl, "Daily notes");

		new Setting(containerEl)
			.setName("Daily notes folder")
			.setDesc("Leave empty to auto-detect from Daily Notes or Periodic Notes plugin")
			.addText(text => text
				.setPlaceholder("e.g. Daily Notes")
				.setValue(this.plugin.settings.dailyNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.dailyNotesFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Daily notes format")
			.setDesc("Moment.js date format for daily note filenames (auto-detected if empty)")
			.addText(text => text
				.setPlaceholder("YYYY-MM-DD")
				.setValue(this.plugin.settings.dailyNotesFormat)
				.onChange(async (value) => {
					this.plugin.settings.dailyNotesFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Log section heading")
			.setDesc("The heading text that marks the start of log entries in daily notes")
			.addText(text => text
				.setPlaceholder("Log")
				.setValue(this.plugin.settings.logSectionHeading)
				.onChange(async (value) => {
					this.plugin.settings.logSectionHeading = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Fold properties by default")
			.setDesc("Open notes with their properties collapsed. Applied while the note loads, so there's no flash of expanded properties")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.foldPropertiesByDefault)
				.onChange(async (value) => {
					this.plugin.settings.foldPropertiesByDefault = value;
					await this.plugin.saveSettings();
				}));
	}

	private displayLogEntries(containerEl: HTMLElement): void {
		this.heading(containerEl, "Log entries");

		new Setting(containerEl)
			.setName("Blank line before timestamp")
			.setDesc("Insert timestamp and link leaves an empty line above the new entry instead of just moving to the next line")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.insertBlankLine)
				.onChange(async (value) => {
					this.plugin.settings.insertBlankLine = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Frequency-sorted link suggest")
			.setDesc("Show link suggestions sorted by usage frequency after inserting a timestamp")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.frequencySuggestEnabled)
				.onChange(async (value) => {
					this.plugin.settings.frequencySuggestEnabled = value;
					await this.plugin.saveSettings();
					// Builds the cache now that it's wanted, or drops it now that it isn't
					this.plugin.rebuildFrequencyCache();
				}));

		new Setting(containerEl)
			.setName("Space after log link")
			.setDesc("After selecting a [[link]] suggestion on a log line (HH:MM [[link]]), insert a space so the value can be typed right away")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.spaceAfterLogLink)
				.onChange(async (value) => {
					this.plugin.settings.spaceAfterLogLink = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Insert between {}")
			.setDesc("Wrap inserted emotions in curly braces, e.g. {Energetic, Interested}")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.insertBetweenBraces)
				.onChange(async (value) => {
					this.plugin.settings.insertBetweenBraces = value;
					await this.plugin.saveSettings();
				}));
	}

	private displayEditorAppearance(containerEl: HTMLElement): void {
		this.heading(containerEl, "Editor appearance");

		new Setting(containerEl)
			.setName("Journal entry spacing")
			.setDesc("Extra space (in em) above and below lines that start with a timestamp in daily notes, so blank lines between entries aren't needed (0 = off)")
			.addSlider(slider => slider
				.setLimits(0, 2, 0.05)
				.setValue(this.plugin.settings.timestampLineGap)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.timestampLineGap = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Monospace timestamps")
			.setDesc("Render the HH:MM at the start of journal lines in the monospace font so entries line up")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.timestampMonospace)
				.onChange(async (value) => {
					this.plugin.settings.timestampMonospace = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Muted timestamps")
			.setDesc("Render the HH:MM at the start of journal lines in the muted text color so entries stand out")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.timestampMuted)
				.onChange(async (value) => {
					this.plugin.settings.timestampMuted = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("12-hour timestamps")
			.setDesc("Show the HH:MM at the start of journal lines as a 12-hour time (14:35 → 2:35 with a small pm badge). The note text isn't changed: the 12-hour time is drawn over it, so the rest of the line stays put. The raw time shows while the cursor is on it")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.timestampTwelveHour)
				.onChange(async (value) => {
					this.plugin.settings.timestampTwelveHour = value;
					await this.plugin.saveSettings();
					// Nudges every open editor so the decorations rebuild without a keystroke
					this.app.workspace.updateOptions();
				}));

		new Setting(containerEl)
			.setName("Highlight feelings in editor")
			.setDesc("Underline emotions inside {} with a colored line matching their position on the feelings wheel")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.feelingsHighlight)
				.onChange(async (value) => {
					this.plugin.settings.feelingsHighlight = value;
					await this.plugin.saveSettings();
				}));
	}

	private displayInfiniteJournal(containerEl: HTMLElement): void {
		this.heading(containerEl, "Infinite journal");

		new Setting(containerEl)
			.setName("Infinite journal")
			.setDesc("Enable the infinite-scrolling journal view of daily notes")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.infiniteJournal)
				.onChange(async (value) => {
					this.plugin.settings.infiniteJournal = value;
					await this.plugin.saveSettings();
					this.plugin.updateJournalRibbon();
				}));

		new Setting(containerEl)
			.setName("Show relative dates")
			.setDesc("Show journal day headers as Today, Yesterday, Last Friday, etc. instead of the raw date")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.journalRelativeDates)
				.onChange(async (value) => {
					this.plugin.settings.journalRelativeDates = value;
					await this.plugin.saveSettings();
					this.plugin.refreshJournalViews();
				}));

		new Setting(containerEl)
			.setName("Replace daily note")
			.setDesc("Open the infinite journal (scrolled to today) instead of a single note when using the Open today's daily note command")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.journalReplaceDailyNote)
				.onChange(async (value) => {
					this.plugin.settings.journalReplaceDailyNote = value;
					await this.plugin.saveSettings();
				}));
	}

	private displayTrackingChart(containerEl: HTMLElement): void {
		this.heading(containerEl, "Tracking chart");

		new Setting(containerEl)
			.setName("Default date range")
			.setDesc("Number of days to show by default")
			.addDropdown(drop => drop
				.addOptions({"7": "7 days", "14": "14 days", "30": "30 days", "90": "90 days"})
				.setValue(String(this.plugin.settings.defaultDateRangeDays))
				.onChange(async (value) => {
					this.plugin.settings.defaultDateRangeDays = Number(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Default enabled group")
			.setDesc("Group to enable on first load when no topics have tracking_visible_default set")
			.addText(text => text
				.setPlaceholder("mood")
				.setValue(this.plugin.settings.defaultEnabledGroup)
				.onChange(async (value) => {
					this.plugin.settings.defaultEnabledGroup = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Narration inherit window")
			.setDesc("Entries without narration inherit from the nearest entry within this many minutes (0 = disabled)")
			.addText(text => text
				.setPlaceholder("0")
				.setValue(String(this.plugin.settings.narrationInheritMinutes))
				.onChange(async (value) => {
					const num = parseInt(value, 10);
					this.plugin.settings.narrationInheritMinutes = isNaN(num) ? 0 : Math.max(0, num);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Auto-embed on daily notes")
			.setDesc("Automatically show a tracking chart at the bottom of daily notes")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoEmbed)
				.onChange(async (value) => {
					this.plugin.settings.autoEmbed = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Auto-embed topics")
			.setDesc("Comma-separated topic names to show in auto-embed (empty = all visible_default topics)")
			.addText(text => text
				.setPlaceholder("Mood, Anxiety, Caffeine")
				.setValue(this.plugin.settings.autoEmbedTopics)
				.onChange(async (value) => {
					this.plugin.settings.autoEmbedTopics = value;
					await this.plugin.saveSettings();
				}));
	}

	private displayFeelingsWheel(containerEl: HTMLElement): void {
		this.heading(containerEl, "Feelings wheel");

		new Setting(containerEl)
			.setName("Show settings icon on wheel")
			.setDesc("Show a cog icon in the feelings wheel dialog to quickly open settings")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showWheelSettingsIcon)
				.onChange(async (value) => {
					this.plugin.settings.showWheelSettingsIcon = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Feelings wheel zoom")
			.setDesc("How much to magnify emotions near the indicator arrow (0 = uniform)")
			.addSlider(slider => slider
				.setLimits(0, 100, 5)
				.setValue(this.plugin.settings.feelingsWheelZoom)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.feelingsWheelZoom = value;
					await this.plugin.saveSettings();
				}));

		// Rolodex tuning is only shown when the 3D effect is "Shrink size"
		let updateRolodexVisibility = () => {};

		new Setting(containerEl)
			.setName("Feelings wheel 3D effect")
			.setDesc("How distant emotions visually recede from the indicator")
			.addDropdown(dropdown => dropdown
				.addOption("off", "Off")
				.addOption("opacity", "Fade opacity")
				.addOption("size", "Shrink size")
				.setValue(this.plugin.settings.feelingsWheel3d)
				.onChange(async (value) => {
					this.plugin.settings.feelingsWheel3d = value as "off" | "opacity" | "size";
					await this.plugin.saveSettings();
					updateRolodexVisibility();
				}));

		const rolodexSection = containerEl.createDiv();
		updateRolodexVisibility = () => {
			rolodexSection.style.display = this.plugin.settings.feelingsWheel3d === "size" ? "" : "none";
		};
		updateRolodexVisibility();
		this.displayRolodexTuning(rolodexSection);

		this.displayWheelPhysics(containerEl);
	}

	private displayRolodexTuning(containerEl: HTMLElement): void {
		this.heading(containerEl, "Rolodex tuning");

		new Setting(containerEl)
			.setName("Sharpness")
			.setDesc("How quickly neighbors shrink (higher = sharper falloff)")
			.addText(text => text
				.setValue(String(this.plugin.settings.rolodexK))
				.onChange(async (value) => {
					const num = parseFloat(value);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.rolodexK = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName("Floor")
			.setDesc("Minimum size for distant segments (lower = thinner slivers)")
			.addText(text => text
				.setValue(String(this.plugin.settings.rolodexFloor))
				.onChange(async (value) => {
					const num = parseFloat(value);
					if (!isNaN(num) && num >= 0) {
						this.plugin.settings.rolodexFloor = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName("Peak")
			.setDesc("Extra size boost for the selected emotion (higher = bigger center)")
			.addText(text => text
				.setValue(String(this.plugin.settings.rolodexPeak))
				.onChange(async (value) => {
					const num = parseFloat(value);
					if (!isNaN(num) && num >= 0) {
						this.plugin.settings.rolodexPeak = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName("Snap strength")
			.setDesc("How strongly the wheel homes to center after a flick (0 = no snap, 0.1 = strong)")
			.addText(text => text
				.setValue(String(this.plugin.settings.rolodexSnap))
				.onChange(async (value) => {
					const num = parseFloat(value);
					if (!isNaN(num) && num >= 0) {
						this.plugin.settings.rolodexSnap = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName("Resolution")
			.setDesc("Lookup table size (higher = smoother transitions)")
			.addText(text => text
				.setValue(String(this.plugin.settings.rolodexResolution))
				.onChange(async (value) => {
					const num = parseInt(value, 10);
					if (!isNaN(num) && num >= 64) {
						this.plugin.settings.rolodexResolution = num;
						await this.plugin.saveSettings();
					}
				}));

		const unitSetting = (
			name: string, desc: string,
			key: "rolodexFontScale" | "rolodexFontCeiling" | "rolodexWeightScale",
		) => {
			new Setting(containerEl)
				.setName(name)
				.setDesc(`${desc} (default: ${DEFAULT_SETTINGS[key]})`)
				.addText(text => text
					.setValue(String(this.plugin.settings[key]))
					.onChange(async (value) => {
						const num = parseFloat(value);
						if (!isNaN(num) && num >= 0 && num <= 1) {
							this.plugin.settings[key] = num;
							await this.plugin.saveSettings();
						}
					}))
				.addExtraButton(btn => btn
					.setIcon("reset")
					.setTooltip("Reset to default")
					.onClick(async () => {
						this.plugin.settings[key] = DEFAULT_SETTINGS[key];
						await this.plugin.saveSettings();
						this.display();
					}));
		};

		unitSetting("Font scaling",
			"How much text scales with segment size — 0 = uniform, 1 = fully proportional",
			"rolodexFontScale");

		unitSetting("Font ceiling",
			"Max font growth multiplier — 0 = no growth, 1 = full growth",
			"rolodexFontCeiling");

		unitSetting("Weight scaling",
			"Scale font weight with segment size — 0 = uniform (600), 1 = full range (300-900)",
			"rolodexWeightScale");
	}

	private displayWheelPhysics(containerEl: HTMLElement): void {
		this.heading(containerEl, "Wheel physics");

		new Setting(containerEl)
			.setName("Reset physics to defaults")
			.setDesc("Restore all wheel physics settings to their default values")
			.addButton(btn => btn
				.setButtonText("Reset")
				.onClick(async () => {
					this.plugin.settings.feelingsWheelReach = DEFAULT_SETTINGS.feelingsWheelReach;
					this.plugin.settings.feelingsWheelSnap = DEFAULT_SETTINGS.feelingsWheelSnap;
					this.plugin.settings.feelingsWheelFriction = DEFAULT_SETTINGS.feelingsWheelFriction;
					await this.plugin.saveSettings();
					this.display();
				}));

		const physicsSetting = (
			name: string, desc: string,
			key: keyof EmilySettings,
			validate: (n: number) => boolean,
		) => {
			new Setting(containerEl)
				.setName(name)
				.setDesc(`${desc} (default: ${DEFAULT_SETTINGS[key]})`)
				.addText(text => text
					.setValue(String(this.plugin.settings[key]))
					.onChange(async (value) => {
						const num = parseFloat(value);
						if (!isNaN(num) && validate(num)) {
							(this.plugin.settings[key] as number) = num;
							await this.plugin.saveSettings();
						}
					}))
				.addExtraButton(btn => btn
					.setIcon("reset")
					.setTooltip("Reset to default")
					.onClick(async () => {
						(this.plugin.settings[key] as number) = DEFAULT_SETTINGS[key] as number;
						await this.plugin.saveSettings();
						this.display();
					}));
		};

		physicsSetting("Viewport reach",
			"How far the wheel extends into the viewport — 0.5 = half, 0.8 = most of screen",
			"feelingsWheelReach", n => n > 0 && n <= 1);

		physicsSetting("Snap strength",
			"How strongly the wheel homes to center after a flick — 0 = no snap",
			"feelingsWheelSnap", n => n >= 0);

		physicsSetting("Inertia (friction)",
			"How quickly the wheel decelerates — 0.8 = heavy, 0.98 = slippery",
			"feelingsWheelFriction", n => n > 0 && n < 1);
	}
}
