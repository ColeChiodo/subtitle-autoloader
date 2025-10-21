import { log } from './helpers';
const browser_ext = typeof browser !== "undefined" ? browser : chrome;

// Default settings
interface SubtitleSettings {
    subsEnabled: boolean;
    offset: number;
    fontSize: number;
    color: string;
}

const defaultSettings: SubtitleSettings = {
    subsEnabled: false,
    offset: 0,
    fontSize: 25,
    color: 'yellow',
};

/**
 * Save settings to browser storage
 */
export async function saveSettings(settings: SubtitleSettings) {
	await browser_ext.storage.local.set({ subtitleSettings: settings });
	log.debug('Settings saved', settings);
}

/**
 * Load settings from browser storage
 */
export async function loadSettings(): Promise<SubtitleSettings> {
	const stored = await browser_ext.storage.local.get('subtitleSettings');
	return stored.subtitleSettings || defaultSettings;
}