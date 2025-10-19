import { Searcher } from "fast-fuzzy";

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

log.info("Background worker loaded");

// Types
interface ParsedTitle {
    title: string;
    season?: number;
    episode?: number;
    episodeTitle?: string;
    year?: number;
}

interface AnimeMetadata {
    english?: string;
    romaji?: string;
    native?: string;
    synonyms?: string[];
    episodes?: { title: string; number: number; season?: number }[];
}

interface SubtitleFile {
    name: string;
    url: string;
}

// GitHub base URLs
const GITHUB_BASE = "https://github.com/Ajatt-Tools/kitsunekko-mirror/tree/8594c17708c2673d86b43530a6cd1a4a6877b908/subtitles/";
const RAW_BASE = "https://raw.githubusercontent.com/Ajatt-Tools/kitsunekko-mirror/8594c17708c2673d86b43530a6cd1a4a6877b908/subtitles/";

// Keep track of visited directories to prevent loops
const visitedDirs = new Set<string>();

/**
 * Parse the input video title
 * @param videoTitle 
 * @returns ParsedTitle
 */
export function parseVideoTitle(videoTitle: string): ParsedTitle {
    const yearMatch = videoTitle.match(/\((\d{4})\)/);
    const year = yearMatch ? parseInt(yearMatch[1]) : undefined;

    const seMatch = videoTitle.match(/S(\d+)[\s:]*E(\d+)/i);
    const season = seMatch ? parseInt(seMatch[1]) : undefined;
    const episode = seMatch ? parseInt(seMatch[2]) : undefined;

    const parts = videoTitle.split(" - ");
    const mainTitle = parts[0].replace(/\(.*?\)/g, "").trim();
    const episodeTitle = parts.length > 2 ? parts.slice(2).join(" - ").replace(/\(.*?\)/g, "").trim() : undefined;

    return { title: mainTitle, season, episode, episodeTitle, year };
}

/**
 * Fetch metadata from AniList
 * @param title 
 * @returns AnimeMetadata
 */
export async function lookupAnimeMetadata(title: string): Promise<AnimeMetadata> {
    const query = `
        query ($search: String) {
            Media(search: $search, type: ANIME) {
                title {
                    english
                    romaji
                    native
                }
                synonyms
                episodes
            }
        }
    `;

    const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query, variables: { search: title } }),
    });

    if (!res.ok) {
        log.warn(`AniList lookup failed for title: ${title}`);
        return {};
    }

    const json = await res.json();
    const media = json.data?.Media;
    if (!media) return {};

    return {
        english: media.title.english,
        romaji: media.title.romaji,
        native: media.title.native,
        synonyms: media.synonyms || [],
    };
}

/**
 * Generate multiple possible title variants
 * @param parsed 
 * @param meta
 * @returns array of possible title variants
 */
export function generateTitleVariants(parsed: ParsedTitle, meta: AnimeMetadata): string[] {
    const candidates = new Set<string>();

    const add = (s?: string) => {
        if (!s) return;
        const base = s.trim();
        candidates.add(base);
        candidates.add(base.replace(/\s+/g, "+"));
        candidates.add(base.replace(/\s+/g, "."));
        candidates.add(base.replace(/\s+/g, "_"));
        candidates.add(base.toLowerCase());
    };

    add(parsed.title);
    add(meta.english);
    add(meta.romaji);
    add(meta.native);
    meta.synonyms?.forEach(add);

    return Array.from(candidates);
}

/**
 * Recursively fetch subtitle files from GitHub directory and subdirectories
 * @param animeDir
 * @returns array of subtitle files
 */
async function fetchGitHubSubtitlesSafe(animeDir: string, depth = 0, maxDepth = 4): Promise<SubtitleFile[]> {
    if (depth > maxDepth) return [];
    if (visitedDirs.has(animeDir)) return [];
    visitedDirs.add(animeDir);

    const url = `${GITHUB_BASE}${encodeURIComponent(animeDir)}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const html = await res.text();
    const files: SubtitleFile[] = [];

    // Match files
    const fileRegex = /<a[^>]+href="\/Ajatt-Tools\/kitsunekko-mirror\/blob\/[a-f0-9]+\/subtitles\/([^"]+\.(srt|ass))"/gi;
    let match;
    while ((match = fileRegex.exec(html))) {
        const relativePath = match[1];
        const name = relativePath.split("/").pop()!;
        const ext = name.split(".").pop()?.toLowerCase();

        if (ext === "ass") {
            log.warn(`Found ${name} (ASS) — only SRT supported`);
            continue;
        } else if (ext !== "srt") continue;

        files.push({ name, url: `${RAW_BASE}${relativePath}` });
    }

    // Match subdirectories
    const dirRegex = /<a[^>]+href="\/Ajatt-Tools\/kitsunekko-mirror\/tree\/[a-f0-9]+\/subtitles\/([^"]+)"/gi;
    const subdirs: string[] = [];
    while ((match = dirRegex.exec(html))) {
        const subdir = match[1];
        if (!visitedDirs.has(subdir)) subdirs.push(subdir);
    }

    // Fetch subdirectories sequentially with small delay to prevent 429
    for (const subdir of subdirs) {
        await new Promise(r => setTimeout(r, 150)); // 150ms delay
        const subFiles = await fetchGitHubSubtitlesSafe(subdir, depth + 1, maxDepth);
        files.push(...subFiles);
    }

    return files;
}

/**
 * Match best subtitle file
 * @param files 
 * @param parsed 
 * @param meta 
 * @returns SubtitleFile
 */
function matchSubtitleFile(
    files: SubtitleFile[],
    parsed: ParsedTitle,
    meta: AnimeMetadata
): SubtitleFile | null {
    if (files.length === 0) return null;

    if (parsed.season && parsed.episode) {
        const regex = new RegExp(`S0?${parsed.season}E0?${parsed.episode}`, "i");
        const direct = files.find((f) => regex.test(f.name));
        if (direct) return direct;
    }

    const candidates = files.map((f) => f.name.toLowerCase());
    const searcher = new Searcher(candidates, { returnMatchData: false, threshold: 0.7 });

    if (parsed.episodeTitle) {
        const titleMatch = searcher.search(parsed.episodeTitle.toLowerCase())[0];
        if (titleMatch) {
            const matchedFile = files.find((f) => f.name.toLowerCase() === titleMatch);
            if (matchedFile) return matchedFile;
        }
    }

    if (meta.episodes && meta.episodes.length > 0 && parsed.episodeTitle) {
        const metaMatch = meta.episodes.find((ep) =>
            ep.title?.toLowerCase().includes(parsed.episodeTitle!.toLowerCase())
        );
        if (metaMatch) {
            const regex = new RegExp(`E0?${metaMatch.number}`, "i");
            const byNum = files.find((f) => regex.test(f.name));
            if (byNum) return byNum;
        }
    }

    const best = searcher.search(parsed.title.toLowerCase())[0];
    if (best) {
        const fallback = files.find((f) => f.name.toLowerCase() === best);
        if (fallback) return fallback;
    }

    return files[0];
}

/**
 * Final Fetch for subtitle file content
 * @param file 
 * @returns string of subtitle content
 */
async function fetchSubtitleFile(file: SubtitleFile): Promise<string> {
    const res = await fetch(file.url);
    if (!res.ok) log.error(`Failed to fetch subtitle: ${file.url}`);
    return res.text();
}

/**
 * Main function: fetch subtitle by video title
 * @param videoTitle 
 * @returns Object containing subtitle text and file name
 */
export async function fetchSubtitle(
    videoTitle: string,
    context?: { cancelled: boolean }
): Promise<{ text: string; fileName: string | null }> {
    log.debug(`Fetching subtitles for: ${videoTitle}`);
    visitedDirs.clear();

    const parsed = parseVideoTitle(videoTitle);
    const meta = await lookupAnimeMetadata(parsed.title);
    const variants = generateTitleVariants(parsed, meta);

    for (const variant of variants) {
        if (context?.cancelled) {
            log.debug(`Subtitle search cancelled for ${videoTitle}`);
            return { text: "", fileName: null };
        }

        log.debug(`Trying folder variant: ${variant}`);
        const files = await fetchGitHubSubtitlesSafe(variant);
        if (files.length === 0) {
            log.debug(`No subtitle files found in ${variant}`);
            continue;
        }

        const match = matchSubtitleFile(files, parsed, meta);
        if (match) {
            log.debug(`Matched subtitle: ${match.name}`);
            const text = await fetchSubtitleFile(match);
            return { text, fileName: match.name };
        }
    }

    log.warn("No subtitle found for any variant");
    return { text: "", fileName: null };
}

/* ──────────────────────────────────────────────────────────────
   MESSAGE HANDLER: Debounced, Cancel-safe subtitle fetch system
─────────────────────────────────────────────────────────────── */

const activeSearches = new Map<number, { cancelled: boolean }>();
let lastRequest = { title: "", timestamp: 0 };
const DEBOUNCE_MS = 1000;

/**
 * Message handler.
 * @param msg 
 * @param sender 
 * @returns Object containing subtitle text and file name
 */
browser.runtime.onMessage.addListener(async (msg, sender) => {
    log.debug(`Received message from ${sender.id}`, msg);

    if (msg.type !== "GET_SUBS") return;

    const tabId = sender.tab?.id ?? 0;

    if (msg.title === lastRequest.title && Date.now() - lastRequest.timestamp < DEBOUNCE_MS) {
        log.debug(`Skipping duplicate subtitle request for ${msg.title}`);
        return { text: "", fileName: null };
    }
    lastRequest = { title: msg.title, timestamp: Date.now() };

    const prev = activeSearches.get(tabId);
    if (prev) prev.cancelled = true;

    const context = { cancelled: false };
    activeSearches.set(tabId, context);

    log.debug(`[${tabId}] Starting subtitle fetch for: ${msg.title}`);
    const result = await fetchSubtitle(msg.title, context);

    if (context.cancelled) {
        log.debug(`[${tabId}] Search cancelled for ${msg.title}`);
        return { text: "", fileName: null };
    }

    activeSearches.delete(tabId);
    log.debug(`[${tabId}] Finished subtitle fetch, length: ${result.text.length}`);
    return result;
});