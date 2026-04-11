export interface ChartTheme {
	background: string;
	text: string;
	textMuted: string;
	gridLine: string;
	tooltipBg: string;
	tooltipText: string;
}

export function getTheme(el: HTMLElement): ChartTheme {
	const style = getComputedStyle(el);
	const get = (prop: string) => style.getPropertyValue(prop).trim();

	return {
		background: get("--background-primary") || "#ffffff",
		text: get("--text-normal") || "#333333",
		textMuted: get("--text-muted") || "#999999",
		gridLine: get("--background-modifier-border") || "#e0e0e0",
		tooltipBg: get("--background-secondary") || "#f5f5f5",
		tooltipText: get("--text-normal") || "#333333",
	};
}
