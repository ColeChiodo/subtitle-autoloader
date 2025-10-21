/// <reference types="chrome"/>
// Imports
import { log, sanitizeFileName, parseVideoTitle } from './helpers';
import { loadSettings, saveSettings } from './storage';
import { createMenu, initSubtitles } from './overlay';
import { parseSRTFile } from './parseSRT';

const browser_ext = typeof browser !== "undefined" ? browser : chrome;

let currentOverlay: HTMLElement | null = null;
let currentVideo: HTMLVideoElement | HTMLIFrameElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let watching = false;

interface Subtitle {
	start: number;
	end: number;
	text: string;
}

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
 * Attaches the overlay to a video.
 * @param video 
 */
async function attachOverlay(
    media: HTMLVideoElement | HTMLIFrameElement,
    getTitle: () => string | null,
    getButtonsContainer: (media: HTMLVideoElement | HTMLIFrameElement) => HTMLElement | null,
    getSearchQuery?: (title: string | null) => any
) {
    cleanupOverlay();

    const settings = await loadSettings();
    subsEnabled = settings.subsEnabled;
    subtitleOffset = settings.offset;
    fontSize = settings.fontSize;
    subtitleColor = settings.color;

    const overlay = initSubtitles(subsEnabled ? { subs: true } : { subs: false });
    if (!overlay) return log.error('Failed to create subtitle overlay');

    currentOverlay = overlay;
    currentVideo = media;

    const span = overlay.querySelector('span')!;
    span.style.color = subtitleColor;
    span.style.fontSize = `${fontSize}px`;

    function updateOverlayPosition() {
        const rect = media.getBoundingClientRect();
        if (overlay) {
            overlay.style.top = `${rect.top + rect.height * 0.85}px`;
            overlay.style.left = `${rect.left + rect.width / 2}px`;
            overlay.style.transform = 'translate(-50%, -50%)';
        }
    }
    updateOverlayPosition();

    resizeObserver = new ResizeObserver(updateOverlayPosition);
    resizeObserver.observe(media);
    window.addEventListener('resize', updateOverlayPosition);
    window.addEventListener('scroll', updateOverlayPosition);

    const buttonsContainer = getButtonsContainer(media);
    if (!buttonsContainer) return log.error('Buttons container not found');

    const title = getTitle?.() || '';
    const searchQuery = getSearchQuery ? getSearchQuery(title) : {};

    let subtitles: Subtitle[] = [];
    let lastSubtitle = '';

    const menu = createMenu(
        buttonsContainer,
        { subs: subsEnabled, offset: subtitleOffset, color: subtitleColor, fontSize, search: searchQuery },
        async (subs, offset, color, fontS) => {
            let updated = false;

            if (subsEnabled !== subs) { subsEnabled = subs; updated = true; }
            if (subtitleOffset !== offset) { subtitleOffset = offset; updated = true; }
            if (subtitleColor !== color) { subtitleColor = color; updated = true; }
            if (fontSize !== fontS) { fontSize = fontS; updated = true; }

            if (updated) await saveSettings({ subsEnabled, offset: subtitleOffset, fontSize, color: subtitleColor });

            overlay.style.display = subsEnabled ? 'flex' : 'none';
            span.style.color = subtitleColor;
            span.style.fontSize = `${fontSize}px`;
        },
        async (queryObj) => {
            if (!menu) return log.error('Menu not found');

            // Convert search query object into a string
            let query = queryObj.animeTitle;
            if (queryObj.season) query += ` - S${queryObj.season}E${queryObj.episodeNumber}`;
            else if (queryObj.episodeNumber) query += ` - E${queryObj.episodeNumber}`;
            if (queryObj.episodeTitle) query += ` - ${queryObj.episodeTitle}`;

            const result = await (browser_ext.runtime.sendMessage as (msg: any) => Promise<any>)({
                type: "GET_SUBS",
                title: query,
            });

            const { text: srtText, fileName } = result as { text: string; fileName: string | null };
            if (!srtText) {
                const fileNameSpan = menu.querySelector('.fileName');
                if (fileNameSpan) fileNameSpan.textContent = 'No subtitles found';
                return log.error('No subtitles found');
            }

            subtitles = parseSRTFile(srtText);
            const fileNameSpan = menu.querySelector('.fileName');
            if (fileNameSpan) fileNameSpan.textContent = `${sanitizeFileName(fileName || 'Kuraji Subtitles')}` || 'No subtitles found';

            // Video time updates
            if (media instanceof HTMLVideoElement) {
                media.addEventListener('timeupdate', () => {
                    if (!subsEnabled) return;
                    const currentTime = media.currentTime + (subtitleOffset / 1000);
                    const current = subtitles.find(s => currentTime >= s.start && currentTime <= s.end);
                    const text = current ? current.text : '';
                    span.textContent = text;
                    span.style.color = subtitleColor;
                    if (text !== lastSubtitle) lastSubtitle = text;
                });
            } else {
                // Iframe: listen for postMessage events with time
                window.addEventListener('message', (event) => {
                    if (!subsEnabled) return;
                    try {
                        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                        if (!data?.event || typeof data.time !== 'number') return;

                        const currentTime = data.time + (subtitleOffset / 1000);
                        const current = subtitles.find(s => currentTime >= s.start && currentTime <= s.end);
                        const text = current ? current.text : '';
                        span.textContent = text;
                        span.style.color = subtitleColor;
                        if (text !== lastSubtitle) lastSubtitle = text;
                    } catch (err) { }
                });
            }
        }
    );
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
        await attachOverlay(
            video,
            () => document.querySelector('.pageTitle')!.textContent,
            (_video) => {
                const osdControls = document.querySelectorAll<HTMLDivElement>('.osdControls');
                if (!osdControls.length) return null;
                const buttonsContainer = osdControls[osdControls.length - 1].querySelectorAll<HTMLDivElement>('.buttons');
                return buttonsContainer[buttonsContainer.length - 1] || null;
            },
            (title) => parseVideoTitle(title || '')
        );
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
 * Handles navigation within Hianime.
 * If navigating to an iframe, attach listener for video time messages.
 */
async function handleIFrame(iframe: HTMLIFrameElement) {
    if (watching) return;
    log.debug('handling iframe');

    if (iframe && iframe !== currentVideo) {
        await attachOverlay(
            iframe,
            () => '',
            (iframe) => {
                const container = document.createElement('div');
                container.classList.add('kuraji-buttons');
                Object.assign(container.style, {
                    position: 'absolute',
                    bottom: '0',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: '999999999'
                });
                iframe.parentNode?.insertBefore(container, iframe.nextSibling);
                return container;
            }
        );
    }
}

/**
 * Initialize - checks the current page to handle events differently
 */
async function init() {
    if (document.title.toLowerCase().includes('jellyfin')) {
        log.info('Detected Jellyfin web client');
        watchJellyfin();
    } 

    const iframe = document.querySelector('iframe');
    if (iframe) {
        log.info('iframe detected:', iframe.src);
        handleIFrame(iframe as HTMLIFrameElement);
    }
}

init();
