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

		new Setting(containerEl)
			.setName("Frequency-sorted link suggest")
			.setDesc("Show link suggestions sorted by usage frequency after inserting a timestamp")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.frequencySuggestEnabled)
				.onChange(async (value) => {
					this.plugin.settings.frequencySuggestEnabled = value;
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
				}));

		// Rolodex tuning — only shown when 3D effect is "Shrink size"
		const rolodexSection = containerEl.createDiv();
		const updateRolodexVisibility = () => {
			rolodexSection.style.display = this.plugin.settings.feelingsWheel3d === "size" ? "" : "none";
		};
		updateRolodexVisibility();

		// Re-wire the dropdown above to toggle visibility
		const dropdown3d = containerEl.querySelector(".setting-item:last-of-type .dropdown") as HTMLSelectElement | null;
		if (dropdown3d) {
			dropdown3d.addEventListener("change", updateRolodexVisibility);
		}

		rolodexSection.createEl("h3", {text: "Rolodex tuning"});

		new Setting(rolodexSection)
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

		new Setting(rolodexSection)
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

		new Setting(rolodexSection)
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

		new Setting(rolodexSection)
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

		new Setting(rolodexSection)
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

		new Setting(rolodexSection)
			.setName("Font scaling")
			.setDesc(`How much text scales with segment size — 0 = uniform, 1 = fully proportional (default: ${DEFAULT_SETTINGS.rolodexFontScale})`)
			.addText(text => text
				.setValue(String(this.plugin.settings.rolodexFontScale))
				.onChange(async (value) => {
					const num = parseFloat(value);
					if (!isNaN(num) && num >= 0 && num <= 1) {
						this.plugin.settings.rolodexFontScale = num;
						await this.plugin.saveSettings();
					}
				}))
			.addExtraButton(btn => btn
				.setIcon("reset")
				.setTooltip("Reset to default")
				.onClick(async () => {
					this.plugin.settings.rolodexFontScale = DEFAULT_SETTINGS.rolodexFontScale;
					await this.plugin.saveSettings();
					this.display();
				}));

		new Setting(rolodexSection)
			.setName("Font ceiling")
			.setDesc(`Max font growth multiplier — 0 = no growth, 1 = full growth (default: ${DEFAULT_SETTINGS.rolodexFontCeiling})`)
			.addText(text => text
				.setValue(String(this.plugin.settings.rolodexFontCeiling))
				.onChange(async (value) => {
					const num = parseFloat(value);
					if (!isNaN(num) && num >= 0 && num <= 1) {
						this.plugin.settings.rolodexFontCeiling = num;
						await this.plugin.saveSettings();
					}
				}))
			.addExtraButton(btn => btn
				.setIcon("reset")
				.setTooltip("Reset to default")
				.onClick(async () => {
					this.plugin.settings.rolodexFontCeiling = DEFAULT_SETTINGS.rolodexFontCeiling;
					await this.plugin.saveSettings();
					this.display();
				}));

		// Physics tuning section
		const physicsSection = containerEl.createDiv();
		physicsSection.createEl("h3", {text: "Wheel physics"});

		new Setting(physicsSection)
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
			new Setting(physicsSection)
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
