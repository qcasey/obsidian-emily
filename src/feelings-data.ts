export interface EmotionSector {
	core: string;
	color: string;
	secondary: {label: string; tertiary: string[]}[];
}

/**
 * Gloria Willcox feelings wheel — 6 core emotions, each 60°.
 * Colors chosen to match the classic wheel palette.
 *
 * Inspired by https://feelingswheel.com
 * Original wheel concept by Gloria Willcox.
 */
export const FEELINGS_WHEEL: EmotionSector[] = [
	{
		core: "Happy",
		color: "#E88501",
		secondary: [
			{label: "Playful", tertiary: ["Aroused", "Cheeky"]},
			{label: "Content", tertiary: ["Free", "Joyful"]},
			{label: "Interested", tertiary: ["Curious", "Inquisitive"]},
			{label: "Proud", tertiary: ["Successful", "Confident"]},
			{label: "Accepted", tertiary: ["Respected", "Valued"]},
			{label: "Powerful", tertiary: ["Courageous", "Creative"]},
			{label: "Peaceful", tertiary: ["Loving", "Thankful"]},
			{label: "Trusting", tertiary: ["Sensitive", "Intimate"]},
			{label: "Optimistic", tertiary: ["Hopeful", "Inspired"]},
		],
	},
	{
		core: "Sad",
		color: "#322B54",
		secondary: [
			{label: "Lonely", tertiary: ["Isolated", "Abandoned"]},
			{label: "Vulnerable", tertiary: ["Victimized", "Fragile"]},
			{label: "Despair", tertiary: ["Grief", "Powerless"]},
			{label: "Guilty", tertiary: ["Ashamed", "Remorseful"]},
			{label: "Depressed", tertiary: ["Inferior", "Empty"]},
			{label: "Hurt", tertiary: ["Embarrassed", "Disappointed"]},
		],
	},
	{
		core: "Disgusted",
		color: "#B45D32",
		secondary: [
			{label: "Disapproving", tertiary: ["Judgmental", "Embarrassed"]},
			{label: "Disappointed", tertiary: ["Appalled", "Revolted"]},
			{label: "Awful", tertiary: ["Nauseated", "Detestable"]},
			{label: "Repelled", tertiary: ["Horrified", "Hesitant"]},
		],
	},
	{
		core: "Angry",
		color: "#CE2C3C",
		secondary: [
			{label: "Let down", tertiary: ["Betrayed", "Resentful"]},
			{label: "Humiliated", tertiary: ["Disrespected", "Ridiculed"]},
			{label: "Bitter", tertiary: ["Indignant", "Violated"]},
			{label: "Mad", tertiary: ["Furious", "Jealous"]},
			{label: "Aggressive", tertiary: ["Provoked", "Hostile"]},
			{label: "Frustrated", tertiary: ["Infuriated", "Annoyed"]},
			{label: "Distant", tertiary: ["Withdrawn", "Numb"]},
			{label: "Critical", tertiary: ["Skeptical", "Dismissive"]},
		],
	},
	{
		core: "Fearful",
		color: "#D2278A",
		secondary: [
			{label: "Scared", tertiary: ["Helpless", "Frightened"]},
			{label: "Anxious", tertiary: ["Overwhelmed", "Worried"]},
			{label: "Insecure", tertiary: ["Inadequate", "Inferior"]},
			{label: "Weak", tertiary: ["Worthless", "Insignificant"]},
			{label: "Rejected", tertiary: ["Excluded", "Persecuted"]},
			{label: "Threatened", tertiary: ["Nervous", "Exposed"]},
		],
	},
	{
		core: "Surprised",
		color: "#4A745F",
		secondary: [
			{label: "Startled", tertiary: ["Shocked", "Dismayed"]},
			{label: "Confused", tertiary: ["Disillusioned", "Perplexed"]},
			{label: "Amazed", tertiary: ["Astonished", "Awe"]},
			{label: "Excited", tertiary: ["Eager", "Energetic"]},
		],
	},
];

/** Precomputed flat list of all segments with angular positions */
export interface FlatSegment {
	label: string;
	tier: "core" | "secondary" | "tertiary";
	color: string;
	startAngle: number;
	endAngle: number;
	sectorIndex: number;
}

/** Lighten a hex color by mixing with white */
function lighten(hex: string, amount: number): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	const lr = Math.round(r + (255 - r) * amount);
	const lg = Math.round(g + (255 - g) * amount);
	const lb = Math.round(b + (255 - b) * amount);
	return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

/** Darken a hex color by mixing toward black */
function darken(hex: string, amount: number): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	const dr = Math.round(r * (1 - amount));
	const dg = Math.round(g * (1 - amount));
	const db = Math.round(b * (1 - amount));
	return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db.toString(16).padStart(2, "0")}`;
}

/** Shift hue slightly for visual distinction between adjacent tertiary segments */
function hueShift(hex: string, degrees: number): string {
	let r = parseInt(hex.slice(1, 3), 16) / 255;
	let g = parseInt(hex.slice(3, 5), 16) / 255;
	let b = parseInt(hex.slice(5, 7), 16) / 255;

	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	const l = (max + min) / 2;
	let h = 0, s = 0;

	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
		else if (max === g) h = ((b - r) / d + 2) / 6;
		else h = ((r - g) / d + 4) / 6;
	}

	h = ((h * 360 + degrees) % 360 + 360) % 360 / 360;

	const hue2rgb = (p: number, q: number, t: number) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};

	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	r = hue2rgb(p, q, h + 1 / 3);
	g = hue2rgb(p, q, h);
	b = hue2rgb(p, q, h - 1 / 3);

	const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function buildFlatSegments(): {
	core: FlatSegment[];
	secondary: FlatSegment[];
	tertiary: FlatSegment[];
} {
	const core: FlatSegment[] = [];
	const secondary: FlatSegment[] = [];
	const tertiary: FlatSegment[] = [];

	// Count total tertiary emotions to divide the circle evenly
	let totalTertiary = 0;
	for (const sector of FEELINGS_WHEEL) {
		for (const sec of sector.secondary) {
			totalTertiary += sec.tertiary.length;
		}
	}

	const TWO_PI = Math.PI * 2;
	const sliceAngle = TWO_PI / totalTertiary;
	let angle = 0;

	for (let si = 0; si < FEELINGS_WHEEL.length; si++) {
		const sector = FEELINGS_WHEEL[si]!;
		const sectorStart = angle;

		let secIdx = 0;
		const totalSec = sector.secondary.length;
		for (let sei = 0; sei < totalSec; sei++) {
			const sec = sector.secondary[sei]!;
			const secStart = angle;

			// Hue-shift each secondary by its position within the sector
			const secHueOffset = ((sei / totalSec) - 0.5) * 20;
			const secColor = hueShift(darken(sector.color, 0.08), secHueOffset);

			for (let ti = 0; ti < sec.tertiary.length; ti++) {
				// Alternate lighten/darken + hue shift for distinct tertiary colors
				const tertHueOffset = secHueOffset + (ti === 0 ? -6 : 6);
				const tertLighten = ti === 0 ? 0.2 : 0.35;
				const tertColor = hueShift(lighten(sector.color, tertLighten), tertHueOffset);

				tertiary.push({
					label: sec.tertiary[ti]!,
					tier: "tertiary",
					color: tertColor,
					startAngle: angle,
					endAngle: angle + sliceAngle,
					sectorIndex: si,
				});
				angle += sliceAngle;
			}

			secondary.push({
				label: sec.label,
				tier: "secondary",
				color: secColor,
				startAngle: secStart,
				endAngle: angle,
				sectorIndex: si,
			});
			secIdx++;
		}

		core.push({
			label: sector.core,
			tier: "core",
			color: sector.color,
			startAngle: sectorStart,
			endAngle: angle,
			sectorIndex: si,
		});
	}

	return {core, secondary, tertiary};
}
