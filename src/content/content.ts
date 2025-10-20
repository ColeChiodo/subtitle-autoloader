/// <reference types="chrome"/>
// Imports
import { createMenu, initSubtitles } from './overlay';
import { parseSRTFile } from './parseSRT';

const browser_ext = typeof browser !== "undefined" ? browser : chrome;

const EXT = "[Kuraji]";

/**
 * Custom logger to prefix logs with the extension name.
 */
const log = {
    info: (msg: string, ...args: any[]) => console.log(`${EXT} [INFO]`, msg, ...args),
    debug: (msg: string, ...args: any[]) => console.debug(`${EXT} [DEBUG]`, msg, ...args),
    warn: (msg: string, ...args: any[]) => console.warn(`${EXT} [WARN]`, msg, ...args),
    error: (msg: string, ...args: any[]) => console.error(`${EXT} [ERROR]`, msg, ...args),
};

/**
 * Turn a file name in url format into a human-readable string
 * @param rawName 
 * @returns 
 */
function sanitizeFileName(rawName: string): string {
    try {
        // Decode URL-encoded characters
        let name = decodeURIComponent(rawName);

        // Optional: remove any leading/trailing whitespace
        name = name.trim();

        // Optional: replace brackets with normal parentheses, just for display
        name = name.replace(/\[/g, '(').replace(/\]/g, ')');

        // Optional: remove any non-printable/control characters
        name = name.replace(/[\x00-\x1F\x7F]/g, '');

        return name;
    } catch (e) {
        // If decoding fails, fallback to the raw string
        return rawName;
    }
}

let currentOverlay: HTMLElement | null = null;
let currentVideo: HTMLVideoElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let watching = false;

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

// Current settings
let subsEnabled = defaultSettings.subsEnabled;
let subtitleOffset = defaultSettings.offset;
let fontSize = defaultSettings.fontSize;
let subtitleColor = defaultSettings.color;

/**
 * Save settings to browser storage
 */
async function saveSettings(settings: SubtitleSettings) {
    await browser_ext.storage.local.set({ subtitleSettings: settings });
    log.debug('Settings saved', settings);
}

/**
 * Load settings from browser storage
 */
async function loadSettings(): Promise<SubtitleSettings> {
    const stored = await browser_ext.storage.local.get('subtitleSettings');
    return stored.subtitleSettings || defaultSettings;
}

/**
 * Attaches the overlay to a video.
 * @param video 
 */
async function attachOverlayToVideo(video: HTMLVideoElement) {
    cleanupOverlay();

    // Load saved settings
    const settings = await loadSettings();
    subsEnabled = settings.subsEnabled;
    subtitleOffset = settings.offset;
    fontSize = settings.fontSize;
    subtitleColor = settings.color;

    // Get video title from somewhere on the page
    const titleEl = document.querySelector('.pageTitle');
    if (!titleEl) return log.error('No title found');
    const title = titleEl.textContent;

    const overlay = initSubtitles(subsEnabled ? { subs: true } : { subs: false });
    if (!overlay) return log.error('Failed to create subtitle overlay');

    currentOverlay = overlay;
    currentVideo = video;

    const span = overlay.querySelector('span')!;
    span.style.color = subtitleColor;
    span.style.fontSize = `${fontSize}px`;

    function updateOverlayPosition() {
        const rect = video.getBoundingClientRect();
        if (!overlay) return;
        overlay.style.top = `${rect.top + rect.height * 0.85}px`;
        overlay.style.left = `${rect.left + rect.width / 2}px`;
        overlay.style.transform = 'translate(-50%, -50%)';
    }
    updateOverlayPosition();

    resizeObserver = new ResizeObserver(updateOverlayPosition);
    resizeObserver.observe(video);
    window.addEventListener('resize', updateOverlayPosition);
    window.addEventListener('scroll', updateOverlayPosition);

    // Get location of where menu button should go
    const osdControlsList = document.querySelectorAll<HTMLDivElement>('.osdControls');
    if (!osdControlsList.length) return;
    const osdControls = osdControlsList[osdControlsList.length - 1];
    const buttonsContainerList = osdControls.querySelectorAll<HTMLDivElement>('.buttons');
    if (!buttonsContainerList.length) return;
    const buttonsContainer = buttonsContainerList[buttonsContainerList.length - 1];

    // Pass the fileName to createMenu for display
    const menu = createMenu(
        buttonsContainer,
        { subs: subsEnabled, offset: subtitleOffset, color: subtitleColor, fontSize },
        async (subs, offset, color, fontS) => {
            let updated = false;

            if (subsEnabled !== subs) {
                subsEnabled = subs;
                log.debug(`Subtitles ${subs ? 'enabled' : 'disabled'}`);
                updated = true;
            }
            if (subtitleOffset !== offset) {
                subtitleOffset = offset;
                log.debug(`Subtitle offset set to ${subtitleOffset}`);
                updated = true;
            }
            if (subtitleColor !== color) {
                subtitleColor = color;
                log.debug(`Subtitle color set to ${subtitleColor}`);
                updated = true;
            }
            if (fontSize !== fontS) {
                fontSize = fontS;
                log.debug(`Subtitle font size set to ${fontSize}`);
                updated = true;
            }

            // Save updated settings
            if (updated) {
                await saveSettings({ subsEnabled, offset: subtitleOffset, fontSize, color: subtitleColor });
            }

            overlay.style.display = subsEnabled ? 'flex' : 'none';
            span.style.color = subtitleColor;
            span.style.fontSize = `${fontSize}px`;
        }
    );
    if (!menu) return log.error('Failed to create menu');

    // Request subtitle from background script
    const result = await (browser_ext.runtime.sendMessage as (msg: any) => Promise<any>)({
        type: "GET_SUBS",
        title,
    });
    const { text: srtText, fileName: fileName } = result as { text: string; fileName: string | null };
    if (!srtText) {
        const fileNameSpan = menu.querySelector('.fileName');
        if (fileNameSpan) fileNameSpan.textContent = 'No subtitles found';
        return log.error('No subtitles found');
    } 

    // Parse subtitle file
    const subtitles = parseSRTFile(srtText);

    // Put filename in menu child with class fileName
    const fileNameSpan = menu.querySelector('.fileName');
    if (fileNameSpan) fileNameSpan.textContent = `${sanitizeFileName(fileName || 'Kuraji Subtitles')}` || 'No subtitles found';

    let lastSubtitle = '';
    video.addEventListener('timeupdate', () => {
        if (!subsEnabled) return;
        const currentTime = video.currentTime + (subtitleOffset / 1000);
        const current = subtitles.find(s => currentTime >= s.start && currentTime <= s.end);
        const text = current ? current.text : '';
        span.textContent = text;
        span.style.color = subtitleColor;
        if (text !== lastSubtitle) lastSubtitle = text;
    });
}

/**
 * Removes the overlay from the page
 */
function cleanupOverlay() {
    if (resizeObserver && currentVideo) resizeObserver.unobserve(currentVideo);
    if (currentOverlay) {
        currentOverlay.querySelectorAll('span').forEach(s => s.remove());
        currentOverlay.remove();
    }
    currentOverlay = null;
    currentVideo = null;
}

/**
 * Handles navigation within Jellyfin.
 * If navigating to a video page, attach overlay.
 * If navigating away from a video page, remove overlay.
 */
async function handleJellyfin() {
    const isVideoPage = window.location.hash.startsWith('#/video');
    if (!isVideoPage) {
        cleanupOverlay();
        return;
    }

    const video = document.querySelector('video');
    if (video && video !== currentVideo) {
        await attachOverlayToVideo(video);
    }
}

/**
 * Set a listener for page navigation within Jellyfin
 */
function watchJellyfin() {
    if (watching) return;
    watching = true;

    log.debug('Watching for Jellyfin navigation');

    const observer = new MutationObserver(() => {
        const video = document.querySelector('video');
        const onVideoPage = window.location.hash.startsWith('#/video');
        if (onVideoPage && video && video !== currentVideo) handleJellyfin();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Initialize - checks the current page to handle events differently
 */
async function init() {
    if (document.title.toLowerCase().includes('jellyfin')) {
        log.debug('Detected Jellyfin web client');
        watchJellyfin();
    }
}

init();
