import { Searcher } from "fast-fuzzy";
import chrome from "webextension-polyfill";
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

log.info(`\n
 /$$   /$$                                  /$$
| $$  /$$/                                 |__/
| $$ /$$/  /$$   /$$  /$$$$$$  /$$$$$$  /$$ /$$
| $$$$$/  | $$  | $$ /$$__  $$|____  $$|__/| $$
| $$  $$  | $$  | $$| $$  \\__/ /$$$$$$$ /$$| $$
| $$\\  $$ | $$  | $$| $$      /$$__  $$| $$| $$
| $$ \\  $$|  $$$$$$/| $$     |  $$$$$$$| $$| $$
|__/  \\__/ \\______/ |__/      \\_______/| $$|__/
                                  /$$  | $$    
                                 |  $$$$$$/    
                                  \\______/     `);

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
    malId?: number;
}

interface SubtitleFile {
    name: string;
    url: string;
    extension: string;
}

// Keep track of visited directories to prevent loops
const visitedDirs = new Set<string>();

/**
 * Parse the input video title
 */
export function parseVideoTitle(videoTitle: string): ParsedTitle {
    log.debug(`Parsing video title: ${videoTitle}`);
    const yearMatch = videoTitle.match(/\((\d{4})\)/);
    const year = yearMatch ? parseInt(yearMatch[1]) : undefined;

    const seMatch = videoTitle.match(/S(\d+)[\s:]*E(\d+)/i);
    const season = seMatch ? parseInt(seMatch[1]) : undefined;
    const episode = seMatch ? parseInt(seMatch[2]) : undefined;

    const parts = videoTitle.split(" - ").map(p => p.trim()).filter(Boolean);
    const mainTitle = parts[0]?.replace(/\(.*?\)/g, "").trim() || videoTitle.trim();

    let episodeTitle: string | undefined;
    if (seMatch && parts.length > 2) {
        episodeTitle = parts.slice(2).join(" - ").replace(/\(.*?\)/g, "").trim();
    } else if (parts.length > 1) {
        episodeTitle = parts.slice(1).join(" - ").replace(/\(.*?\)/g, "").trim();
    }

    return { title: mainTitle, season, episode, episodeTitle, year };
}

/**
 * Query MAL for all episodes
 */
async function getAllEpisodesMAL(malId: number) {
    log.debug(`Fetching all episodes for MAL ID ${malId}`);
    let episodes: { number: number; title: string }[] = [];
    let page = 1;
    let morePages = true;

    while (morePages) {
        const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`);
        const json = await res.json();
        episodes.push(...json.data.map((ep: any) => ({
            number: ep.mal_id,
            title: ep.title
        })));
        morePages = !!json.pagination.has_next_page;
        log.debug(`Fetched ${episodes.length} episodes for MAL ID ${malId}`);
        page++;
    }

    return episodes;
}

/**
 * Fetch metadata from AniList
 */
export async function lookupAnimeMetadata(title: string): Promise<AnimeMetadata> {
    log.debug(`Fetching metadata for title: ${title}`);
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
                idMal
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
    if (!media) {
        log.warn(`AniList lookup failed for title: ${title}`);
        return {};
    }

    return {
        english: media.title.english,
        romaji: media.title.romaji,
        native: media.title.native,
        synonyms: media.synonyms || [],
        malId: media.idMal,
    };
}

/**
 * Generate multiple possible title variants
 */
export function generateTitleVariants(parsed: ParsedTitle, meta: AnimeMetadata): string[] {
    log.debug(`Generating title variants for: ${parsed.title}`);
    const candidates = new Set<string>();

    const add = (s?: string) => {
        if (!s) return;
        const base = s.trim();
        candidates.add(base);
        candidates.add(base.replace(/\s+/g, "+"));
        candidates.add(base.replace(/\s+/g, "."));
        candidates.add(base.replace(/\s+/g, "_"));
        candidates.add(base.toLowerCase());

        // add varient without last character
        if (base.length > 1) {
            candidates.add(base.slice(0, -1));
        }
    };

    add(parsed.title);
    add(meta.english);
    add(meta.romaji);
    add(meta.native);
    meta.synonyms?.forEach(add);

    log.debug(`Generated ${candidates.size} variants`);

    return Array.from(candidates);
}

const SUBTITLE_CATEGORIES = [
    "anime_movie",
    "anime_tv",
    "drama_movie",
    "drama_tv",
    "unsorted"
];

const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

interface CategoryCache {
    folders: string[];
    timestamp: number;
}

interface FolderCache {
    anime_movie?: CategoryCache;
    anime_tv?: CategoryCache;
    drama_movie?: CategoryCache;
    drama_tv?: CategoryCache;
    unsorted?: CategoryCache;
}

async function getCachedFolders(category: string): Promise<string[] | null> {
    try {
        const stored = await browser_ext.storage.local.get("categoryCache");
        const cache: FolderCache = stored.categoryCache || {};
        const catCache = cache[category as keyof FolderCache];
        
        if (catCache && Date.now() - catCache.timestamp < CACHE_TTL_MS) {
            log.debug(`Using cached folders for ${category}: ${catCache.folders.length} folders`);
            return catCache.folders;
        }
    } catch (err) {
        log.warn(`Failed to read cache: ${err}`);
    }
    return null;
}

async function setCachedFolders(category: string, folders: string[]): Promise<void> {
    try {
        const stored = await browser_ext.storage.local.get("categoryCache");
        const cache: FolderCache = stored.categoryCache || {};
        cache[category as keyof FolderCache] = { folders, timestamp: Date.now() };
        await browser_ext.storage.local.set({ categoryCache: cache });
        log.debug(`Cached ${folders.length} folders for ${category}`);
    } catch (err) {
        log.warn(`Failed to write cache: ${err}`);
    }
}

async function fetchCategoryFolders(category: string): Promise<string[]> {
    const cached = await getCachedFolders(category);
    if (cached) return cached;

    log.debug(`Fetching folder list for category: ${category}`);
    const apiUrl = `https://api.github.com/repos/Ajatt-Tools/kitsunekko-mirror/contents/subtitles/${category}`;

    let githubToken: string | undefined;
    try {
        const data = await browser_ext.storage.local.get("githubToken");
        githubToken = data.githubToken;
    } catch (err) {
        log.warn("Failed to read GitHub token from storage:", err);
    }

    const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Kuraji-Extension",
    };
    if (githubToken && /^[a-zA-Z0-9_-]+$/.test(githubToken)) {
        headers.Authorization = "token " + githubToken;
    }

    const res = await fetch(apiUrl, { headers });
    if (!res.ok) {
        log.error(`Error fetching category ${category}: ${res.status}`);
        return [];
    }

    const data: any[] = await res.json();
    const folders = data
        .filter((item: any) => item.type === "dir")
        .map((item: any) => item.name);

    await setCachedFolders(category, folders);
    return folders;
}

/**
 * Searches using cached folder list + fuzzy matching.
 */
async function searchAllGitHubSubtitles(
    animeDir: string, 
    category: string | undefined,
    folderCache: Map<string, string[]>
): Promise<SubtitleFile[]> {
    const categories = category ? [category] : SUBTITLE_CATEGORIES;
    const searchTerm = animeDir.toLowerCase();
    
    log.debug(`Searching for: "${animeDir}" in categories: ${categories.join(", ")}`);
    
    const allFolderMatches: { category: string; folder: string; score: number }[] = [];
    
    for (const cat of categories) {
        let folders = folderCache.get(cat);
        if (!folders) {
            folders = await fetchCategoryFolders(cat);
            folderCache.set(cat, folders);
        }
        
        if (folders.length === 0) continue;
        
        // Use simple includes for partial match
        const matchingFolders = folders.filter(f => 
            f.toLowerCase().includes(searchTerm) || 
            searchTerm.includes(f.toLowerCase())
        );
        
        for (const folder of matchingFolders) {
            allFolderMatches.push({
                category: cat,
                folder: folder,
                score: 1
            });
        }
        
        // Also try fuzzy search
        const folderCandidates = folders.map(f => f.toLowerCase());
        const searcher = new Searcher(folderCandidates, { threshold: 0.3 });
        const fuzzyResults = searcher.search(searchTerm);
        
        for (const result of fuzzyResults) {
            const idx = folderCandidates.indexOf(result);
            if (idx >= 0) {
                allFolderMatches.push({
                    category: cat,
                    folder: folders[idx],
                    score: 0.8
                });
            }
        }
    }
    
    if (allFolderMatches.length === 0) {
        log.debug(`No folder matches found for "${animeDir}"`);
        return [];
    }
    
    // Remove duplicates
    const uniqueMatches = allFolderMatches.filter((match, index, self) =>
        index === self.findIndex((m) => m.folder === match.folder && m.category === match.category)
    );
    
    uniqueMatches.sort((a, b) => b.score - a.score);
    const bestMatch = uniqueMatches[0];
    log.debug(`Best match: "${bestMatch.folder}" (score: ${bestMatch.score}) in ${bestMatch.category}`);
    
    const files = await fetchGitHubSubtitlesSafe(`${bestMatch.category}/${bestMatch.folder}`);
    return files;
}

/**
 * Recursively fetch subtitle files from GitHub using API
 */
async function fetchGitHubSubtitlesSafe(
    path: string, // path now includes category, e.g., "anime_tv/Cowboy Bebop"
    depth = 0,
    maxDepth = 4
): Promise<SubtitleFile[]> {
    log.debug(`Fetching subtitles for path: ${path}`);
    
    if (depth > maxDepth || visitedDirs.has(path)) {
        log.debug(`Skipping path: ${path}`);
        return [];
    }
    visitedDirs.add(path);

    // The base URL now points to the path within the subtitles folder
    const apiUrl = `https://api.github.com/repos/Ajatt-Tools/kitsunekko-mirror/contents/subtitles/${path}`;

    let githubToken: string | undefined;
    try {
        const data = await browser_ext.storage.local.get("githubToken");
        githubToken = data.githubToken;
    } catch (err) {
        log.warn("Failed to read GitHub token from storage:", err);
    }

    const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Kuraji-Extension",
    };
    if (githubToken && /^[a-zA-Z0-9_-]+$/.test(githubToken)) {
        headers.Authorization = "token " + githubToken;
    }

    const res = await fetch(apiUrl, { headers });

    // If a category doesn't contain this specific anime, GitHub returns 404
    if (!res.ok) {
        if (res.status !== 404) {
            log.error(`Error fetching ${path}: ${res.status}`);
        }
        return [];
    }

    const data: any[] = await res.json();
    const files: SubtitleFile[] = [];

    for (const item of data) {
        if (item.type === "file") {
            const ext = item.name.split(".").pop()?.toLowerCase();
            if (ext === "srt" || ext === "ass") {
                files.push({ name: item.name, url: item.download_url, extension: ext });
            }
        } else if (item.type === "dir") {
            // Recurse into subdirectories
            // item.path is the full path from repo root (e.g. "subtitles/anime_tv/Show/Season1")
            const relativePath = item.path.replace(/^subtitles\//, "");
            const subFiles = await fetchGitHubSubtitlesSafe(relativePath, depth + 1, maxDepth);
            files.push(...subFiles);
        }
    }

    return files;
}

/**
 * Match best subtitle file
 */
async function matchSubtitleFile(
    files: SubtitleFile[],
    parsed: ParsedTitle,
    meta: AnimeMetadata
): Promise<SubtitleFile | null> {
    log.debug(`Matching subtitle file for title: ${parsed.title}`);
    if (files.length === 0) return null;

    // Direct season + episode match
    if (parsed.season && parsed.episode) {
        const regex = new RegExp(`S0*${parsed.season}E0*${parsed.episode}(?!\\d)`, "i");
        const direct = files.find(f => regex.test(f.name));
        if (direct) {
            log.debug(`Found direct season+episode match: ${direct.name}`);
            return direct;
        }
    }

    // Episode-only match (allow optional season prefix)
    if (!parsed.season && parsed.episode) {
        // Match E03, 03, S01E03 as separate number tokens
        const epNum = parsed.episode.toString().padStart(1, '0'); // "3" => "3" or "03" optional
        const regex = new RegExp(`(?:S\\d+E)?0*${epNum}(?!\\d)`, "i");
        const direct = files.find(f => regex.test(f.name));
        if (direct) {
            log.debug(`Found direct episode-only match (with optional season prefix): ${direct.name}`);
            return direct;
        }
    }

    // Episode title match via MAL metadata
    if (parsed.episodeTitle && meta.malId) {
        const episodes = await getAllEpisodesMAL(meta.malId);
        if (episodes && episodes.length > 0) {
            const metaMatch = episodes.find(ep =>
                ep.title?.toLowerCase().includes(parsed.episodeTitle!.toLowerCase())
            );
            if (metaMatch) {
                const regex = new RegExp(`(?:S0*\\d+)?(?:E0*)?${metaMatch.number}(?!\\d)`, "i");
                const byNum = files.find(f => regex.test(f.name));
                if (byNum) {
                    log.debug(`Found episode-title match: ${byNum.name}`);
                    return byNum;
                }
            }
        }
    }

    // Score files by language priority (Japanese > English > Chinese/Other)
    const scoreFile = (fileName: string): number => {
        const name = fileName.toLowerCase();
        let score = 0;
        
        // Language priority
        if (name.includes('jpn') || name.includes('jap') || name.includes('[jpn]') || name.endsWith('.jpn.ass') || name.endsWith('.jpn.srt')) {
            score = 100;
        } else if (name.includes('eng') || name.includes('[eng]') || name.endsWith('.eng.ass') || name.endsWith('.eng.srt')) {
            score = 50;
        } else if (name.includes('chs') || name.includes('chn') || name.includes('[chs]') || name.endsWith('.chs.ass') || name.endsWith('.chs.srt')) {
            score = 10;
        } else if (name.includes('cht') || name.includes('big5') || name.includes('[cht]')) {
            score = 5;
        }
        
        // Prefer root folder over subdirectories
        const depth = fileName.split('/').length;
        score += (10 - depth) * 2;
        
        return score;
    };

    // Score all files
    const scoredFiles = files.map(f => ({ file: f, score: scoreFile(f.name) }));
    scoredFiles.sort((a, b) => b.score - a.score);

    log.debug(`Top scored files:`, scoredFiles.slice(0, 3).map(f => ({ name: f.file.name, score: f.score })));

    // Fuzzy search on title
    const candidates = files.map(f => f.name.toLowerCase());
    const searcher = new Searcher(candidates, { returnMatchData: false, threshold: 0.7 });
    const best = searcher.search(parsed.title.toLowerCase())[0];
    if (best) {
        const fallback = files.find(f => f.name.toLowerCase() === best);
        if (fallback) {
            log.debug(`Found fuzzy match: ${fallback.name}`);
            return fallback;
        }
    }

    // Default fallback - use highest scored
    const bestScored = scoredFiles[0];
    log.debug(`Returning best scored file: ${bestScored.file.name} (score: ${bestScored.score})`);
    return bestScored.file;
}



/**
 * Fetch subtitle file content
 */
async function fetchSubtitleFile(file: SubtitleFile): Promise<string> {
    log.debug(`Fetching subtitle: ${file.url}`);
    const res = await fetch(file.url);
    if (!res.ok) log.error(`Failed to fetch subtitle: ${file.url}`);
    return res.text();
}

/**
 * Fetch subtitle by video title
 */
export async function fetchSubtitle(
    videoTitle: string,
    context?: { cancelled: boolean },
    category?: string
): Promise<{ text: string; fileName: string | null; extension: string | null }> {
    log.debug(`Fetching subtitle for video: ${videoTitle}, category: ${category || "all"}`);
    visitedDirs.clear();

    const parsed = parseVideoTitle(videoTitle);
    const meta = await lookupAnimeMetadata(parsed.title);

    const hasAniListEntry =
        meta && (meta.english || meta.romaji || meta.native || (meta.synonyms?.length ?? 0) > 0);

    if (!hasAniListEntry) return { text: "Kuraji -「クラジ」", fileName: null, extension: null };

    const variants = generateTitleVariants(parsed, meta);
    const folderCache = new Map<string, string[]>();

    for (const variant of variants) {
        if (context?.cancelled) return { text: "", fileName: null, extension: null };

        log.debug(`Trying variant: "${variant}"`);

        const files = await searchAllGitHubSubtitles(variant, category, folderCache);
        if (files.length === 0) continue;

        const match = await matchSubtitleFile(files, parsed, meta);
        if (match) {
            const text = await fetchSubtitleFile(match);
            return { text, fileName: match.name, extension: match.extension };
        }
    }

    return { text: "", fileName: null, extension: null };
}

interface FolderMatch {
    folder: string;
    category: string;
}

interface FileMatch {
    name: string;
    url: string;
    extension: string;
}

export async function searchFolders(
    videoTitle: string,
    category?: string
): Promise<{ matches: FolderMatch[] }> {
    log.debug(`Searching folders for: ${videoTitle}, category: ${category || "all"}`);
    visitedDirs.clear();

    const parsed = parseVideoTitle(videoTitle);
    const meta = await lookupAnimeMetadata(parsed.title);

    if (!meta) return { matches: [] };

    const variants = generateTitleVariants(parsed, meta);
    const folderCache = new Map<string, string[]>();
    const allMatches: FolderMatch[] = [];

    for (const variant of variants) {
        const matches = await searchFolderMatches(variant, category, folderCache);
        for (const match of matches) {
            if (!allMatches.some(m => m.folder === match.folder && m.category === match.category)) {
                allMatches.push(match);
            }
        }
    }

    log.debug(`Found ${allMatches.length} folder matches`);
    return { matches: allMatches.slice(0, 10) }; // Limit to 10
}

async function searchFolderMatches(
    animeDir: string, 
    category: string | undefined,
    folderCache: Map<string, string[]>
): Promise<FolderMatch[]> {
    const categories = category ? [category] : SUBTITLE_CATEGORIES;
    const searchTerm = animeDir.toLowerCase();
    
    const allFolderMatches: FolderMatch[] = [];
    
    for (const cat of categories) {
        let folders = folderCache.get(cat);
        if (!folders) {
            folders = await fetchCategoryFolders(cat);
            folderCache.set(cat, folders);
        }
        
        if (folders.length === 0) continue;
        
        // Substring match
        const matchingFolders = folders.filter(f => 
            f.toLowerCase().includes(searchTerm) || 
            searchTerm.includes(f.toLowerCase())
        );
        
        for (const folder of matchingFolders) {
            allFolderMatches.push({ folder, category: cat });
        }
        
        // Fuzzy match
        const folderCandidates = folders.map(f => f.toLowerCase());
        const searcher = new Searcher(folderCandidates, { threshold: 0.3 });
        const fuzzyResults = searcher.search(searchTerm);
        
        for (const result of fuzzyResults) {
            const idx = folderCandidates.indexOf(result);
            if (idx >= 0) {
                const folder = folders[idx];
                if (!allFolderMatches.some(m => m.folder === folder)) {
                    allFolderMatches.push({ folder, category: cat });
                }
            }
        }
    }
    
    return allFolderMatches;
}

export async function getFilesInFolder(
    category: string,
    folder: string
): Promise<{ files: FileMatch[] }> {
    log.debug(`Getting files in ${category}/${folder}`);
    visitedDirs.clear();
    
    const files = await fetchGitHubSubtitlesSafe(`${category}/${folder}`);
    
    const fileMatches: FileMatch[] = files.map(f => ({
        name: f.name,
        url: f.url,
        extension: f.extension
    }));
    
    log.debug(`Found ${fileMatches.length} files`);
    return { files: fileMatches };
}

export async function fetchSubtitleByUrl(
    url: string,
    fileName: string
): Promise<{ text: string; fileName: string; extension: string }> {
    const text = await fetchSubtitleFile({ name: fileName, url, extension: fileName.split('.').pop() || 'srt' });
    const extension = fileName.split('.').pop() || 'srt';
    return { text, fileName, extension };
}

/* ──────────────────────────────────────────────────────────────
   MESSAGE HANDLER: Cross-browser, debounced, cancel-safe subtitle fetch
─────────────────────────────────────────────────────────────── */

const activeSearches = new Map<number, { cancelled: boolean }>();
let lastRequest = { title: "", timestamp: 0 };
const DEBOUNCE_MS = 1000;

async function handleMessage(msg: any, sender: any) {
    if (msg.type === "CLEAR_CACHE") {
        try {
            await browser_ext.storage.local.remove("categoryCache");
            log.info("Cache cleared");
            return { success: true };
        } catch (err) {
            log.error("Failed to clear cache:", err);
            return { success: false };
        }
    }
    if (msg.type === "SEARCH_FOLDERS") {
        return await searchFolders(msg.title, msg.category);
    }
    if (msg.type === "GET_FILES") {
        return await getFilesInFolder(msg.category, msg.folder);
    }
    if (msg.type === "GET_SUBS_BY_URL") {
        return await fetchSubtitleByUrl(msg.url, msg.fileName);
    }
    if (msg.type === "LOG_DEBUG") {
        log.debug(msg.message);
        return { text: "", fileName: null, extension: null };
    }
    if (msg.type !== "GET_SUBS") return { text: "", fileName: null, extension: null };

    const tabId = sender.tab?.id ?? 0;

    if (msg.title === lastRequest.title && Date.now() - lastRequest.timestamp < DEBOUNCE_MS) {
        return { text: "", fileName: null, extension: null };
    }
    lastRequest = { title: msg.title, timestamp: Date.now() };

    const prev = activeSearches.get(tabId);
    if (prev) prev.cancelled = true;

    const context = { cancelled: false };
    activeSearches.set(tabId, context);

    const result = await fetchSubtitle(msg.title, context, msg.category);

    if (context.cancelled) return { text: "", fileName: null, extension: null };

    activeSearches.delete(tabId);
    return result;
}

// Register cross-browser message listener
browser_ext.runtime.onMessage.addListener(
    (msg: any, sender: any, sendResponse: (response?: any) => void): true => {
        (async () => {
            try {
                const result = await handleMessage(msg, sender);
                sendResponse(result);
            } catch (err) {
                log.error("Message handler error:", err);
                sendResponse({ text: "", fileName: null, extension: null });
            }
        })();

        return true; // Required for async sendResponse in Chrome
    }
);
