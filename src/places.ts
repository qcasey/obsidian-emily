import {TFile, normalizePath} from "obsidian";
import type {App} from "obsidian";
import type {EmilySettings} from "./types";

export interface LatLng {
	lat: number;
	lng: number;
}

export interface PlaceMatch {
	file: TFile;
	/** Meters from the queried point to the note's coordinates */
	distance: number;
}

/** `"37.77, -122.41"` or `[37.77, -122.41]` → LatLng; anything else → null. */
export function parseLatLng(value: unknown): LatLng | null {
	let parts: unknown[];
	if (typeof value === "string") {
		parts = value.split(/[,\s]+/).filter(Boolean);
	} else if (Array.isArray(value)) {
		parts = value;
	} else {
		return null;
	}
	if (parts.length !== 2) return null;
	const lat = Number(parts[0]);
	const lng = Number(parts[1]);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
	return {lat, lng};
}

/** Great-circle distance in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
	const R = 6371000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLng = toRad(b.lng - a.lng);
	const s = Math.sin(dLat / 2) ** 2
		+ Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * The known place note nearest to `point`, if one lies within the snap
 * radius. Reads each note's `coordinates` property from the metadata cache.
 */
export function findNearestPlace(app: App, settings: EmilySettings, point: LatLng): PlaceMatch | null {
	const folder = normalizePath(settings.placesFolder);
	const prefix = folder && folder !== "/" ? `${folder}/` : "";
	let best: PlaceMatch | null = null;
	for (const file of app.vault.getMarkdownFiles()) {
		if (prefix && !file.path.startsWith(prefix)) continue;
		const coords = parseLatLng(app.metadataCache.getFileCache(file)?.frontmatter?.coordinates);
		if (!coords) continue;
		const distance = distanceMeters(point, coords);
		if (distance <= settings.placeSnapMeters && (!best || distance < best.distance)) {
			best = {file, distance};
		}
	}
	return best;
}

/** Characters Obsidian won't accept in a note name. */
const UNSAFE_NAME_RE = /[\\/:*?"<>|#^[\]]/g;

/** Create a place note with a `coordinates` property, or return the existing one at that path. */
export async function createPlaceNote(app: App, settings: EmilySettings, name: string, point: LatLng): Promise<TFile> {
	const safeName = name.replace(UNSAFE_NAME_RE, "").trim() || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
	const folder = normalizePath(settings.placesFolder);
	const path = normalizePath(folder && folder !== "/" ? `${folder}/${safeName}.md` : `${safeName}.md`);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;
	if (folder && folder !== "/" && !app.vault.getAbstractFileByPath(folder)) {
		await app.vault.createFolder(folder);
	}
	return app.vault.create(path, `---\ncoordinates: ${point.lat}, ${point.lng}\n---\n`);
}
