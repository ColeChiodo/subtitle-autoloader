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

/**
 * Recursively fetch subtitle files from GitHub using API
 * Uses user-supplied GitHub token from storage if available.
 */
async function fetchGitHubSubtitlesSafe(
	animeDir: string,
	depth = 0,
	maxDepth = 4
): Promise<SubtitleFile[]> {
	log.debug(`Fetching subtitles for directory: ${animeDir}`);
	if (depth > maxDepth || visitedDirs.has(animeDir)) {
		log.debug(`Skipping directory: ${animeDir}`);
		return [];
	}
	visitedDirs.add(animeDir);

	const apiUrl = `https://api.github.com/repos/Ajatt-Tools/kitsunekko-mirror/contents/subtitles/${animeDir}`;

	// Load GitHub token from browser storage
	let githubToken: string | undefined;
	try {
		const data = await browser_ext.storage.local.get("githubToken");
		githubToken = data.githubToken;
        log.debug("Loaded GitHub token from storage");
	} catch (err) {
		log.warn("Failed to read GitHub token from storage:", err);
	}

	// Build headers (use token if available)
	const headers: Record<string, string> = {
		Accept: "application/vnd.github.v3+json",
		"User-Agent": "Kuraji-Extension",
	};
	if (githubToken) {
		headers.Authorization = `token ${githubToken}`;
	}

	const res = await fetch(apiUrl, { headers });

	if (!res.ok) {
		log.error(`Failed to fetch API contents for ${animeDir}: ${res.status}`);
		try {
			const errJson = await res.json();
			log.error(`Response:`, errJson);
		} catch {
			log.error(`Response text:`, await res.text());
		}
		return [];
	}

	const data: any[] = await res.json();
	const files: SubtitleFile[] = [];

	for (const item of data) {
		if (item.type === "file") {
			const ext = item.name.split(".").pop()?.toLowerCase();
			if (ext === "ass") {
				log.warn(`Found ${item.name} (ASS) — only SRT supported`);
				continue;
			} else if (ext !== "srt") continue;

			files.push({ name: item.name, url: item.download_url });
		} else if (item.type === "dir") {
			// Extract path relative to `subtitles/` root
			const relativePath = item.path.replace(/^subtitles\//, "");
			const subFiles = await fetchGitHubSubtitlesSafe(relativePath, depth + 1, maxDepth);
			files.push(...subFiles);
		}
	}

	log.debug(`Found ${files.length} subtitle files for directory: ${animeDir}`);
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

    // Fuzzy search on title
    const candidates = files.map(f => f.name.toLowerCase());
    const searcher = new Searcher(candidates, { returnMatchData: false, threshold: 0.7 });
    const best = searcher.search(parsed.title.toLowerCase())[0];
    if (best) {
        const fallback = files.find(f => f.name.toLowerCase() === best);
        if (fallback) {
            log.debug(`Found fallback match: ${fallback.name}`);
            return fallback;
        }
    }

    // Default fallback
    log.debug(`Returning first file: ${files[0].name}`);
    return files[0];
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
    context?: { cancelled: boolean }
): Promise<{ text: string; fileName: string | null }> {
    log.debug(`Fetching subtitle for video: ${videoTitle}`);
    visitedDirs.clear();

    const parsed = parseVideoTitle(videoTitle);
    const meta = await lookupAnimeMetadata(parsed.title);

    const hasAniListEntry =
        meta && (meta.english || meta.romaji || meta.native || (meta.synonyms?.length ?? 0) > 0);

    if (!hasAniListEntry) return { text: "Kuraji -「クラジ」", fileName: null };

    const variants = generateTitleVariants(parsed, meta);

    for (const variant of variants) {
        if (context?.cancelled) return { text: "", fileName: null };

        const files = await fetchGitHubSubtitlesSafe(variant);
        if (files.length === 0) continue;

        const match = await matchSubtitleFile(files, parsed, meta);
        if (match) {
            const text = await fetchSubtitleFile(match);
            return { text, fileName: match.name };
        }
    }

    return { text: "", fileName: null };
}

/* ──────────────────────────────────────────────────────────────
   MESSAGE HANDLER: Cross-browser, debounced, cancel-safe subtitle fetch
─────────────────────────────────────────────────────────────── */

const activeSearches = new Map<number, { cancelled: boolean }>();
let lastRequest = { title: "", timestamp: 0 };
const DEBOUNCE_MS = 1000;

async function handleMessage(msg: any, sender: any) {
    if (msg.type === "LOG_DEBUG") {
        log.debug(msg.message);
        return { text: "", fileName: null };
    }
    if (msg.type !== "GET_SUBS") return { text: "", fileName: null };

    const tabId = sender.tab?.id ?? 0;

    if (msg.title === lastRequest.title && Date.now() - lastRequest.timestamp < DEBOUNCE_MS) {
        return { text: "", fileName: null };
    }
    lastRequest = { title: msg.title, timestamp: Date.now() };

    const prev = activeSearches.get(tabId);
    if (prev) prev.cancelled = true;

    const context = { cancelled: false };
    activeSearches.set(tabId, context);

    const result = await fetchSubtitle(msg.title, context);

    if (context.cancelled) return { text: "", fileName: null };

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
                sendResponse({ text: "", fileName: null });
            }
        })();

        return true; // Required for async sendResponse in Chrome
    }
);
