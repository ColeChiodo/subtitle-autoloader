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

/**
 * Parse the input video title
 * @param videoTitle
 * @returns ParsedTitle object
 */
export function parseVideoTitle(videoTitle: string): ParsedTitle {
	const yearMatch = videoTitle.match(/\((\d{4})\)/);
	const year = yearMatch ? parseInt(yearMatch[1]) : undefined;

	const seMatch = videoTitle.match(/S(\d+)[\s:]*E(\d+)/i);
	const season = seMatch ? parseInt(seMatch[1]) : undefined;
	const episode = seMatch ? parseInt(seMatch[2]) : undefined;

	// Extract episode title (after 2nd '-')
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
 * @returns array of candidate title strings
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
 * Fetch Kitsunekko directory HTML
 * @param animeDir 
 * @returns 
 */
async function fetchDirPage(animeDir: string): Promise<string | null> {
	const url = `https://kitsunekko.net/dirlist.php?dir=subtitles/japanese/${animeDir}/`;
	const res = await fetch(encodeURI(url));
	if (!res.ok) return null;
	return res.text();
}

/**
 * Extract subtitle files from HTML page
 * @param html
 * @returns Array of all subtitle files on page
 */
function extractSubtitleFiles(html: string): SubtitleFile[] {
	const regex = /href="([^"]+\.srt)"/gi;
	const files: SubtitleFile[] = [];
	let match;

	while ((match = regex.exec(html))) {
		const relativePath = decodeURIComponent(match[1]);
		const name = relativePath.split("/").pop() || "";
		const url = new URL(relativePath, "https://kitsunekko.net/").href;
		files.push({ name, url });
	}

	return files;
}

/**
 * Match best subtitle file
 * @param files 
 * @param parsed 
 * @param meta 
 * @returns SubtitleFile if found
 */
function matchSubtitleFile(
	files: SubtitleFile[],
	parsed: ParsedTitle,
	meta: AnimeMetadata
): SubtitleFile | null {
	if (files.length === 0) return null;

	// Exact Season/Episode match
	if (parsed.season && parsed.episode) {
		const regex = new RegExp(`S0?${parsed.season}E0?${parsed.episode}`, "i");
		const direct = files.find((f) => regex.test(f.name));
		if (direct) return direct;
	}

	// Try matching by Episode Title
	const candidates = files.map((f) => f.name.toLowerCase());
	const searcher = new Searcher(candidates, { returnMatchData: false, threshold: 0.7 });

	// if parsed episode title exists
	if (parsed.episodeTitle) {
		const titleMatch = searcher.search(parsed.episodeTitle.toLowerCase())[0];
		if (titleMatch) {
			const matchedFile = files.find((f) => f.name.toLowerCase() === titleMatch);
			if (matchedFile) return matchedFile;
		}
	}

	// Use AniList metadata episode list if available
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

	// Fallback to fuzzy best filename match
	const best = searcher.search(parsed.title.toLowerCase())[0];
	if (best) {
		const fallback = files.find((f) => f.name.toLowerCase() === best);
		if (fallback) return fallback;
	}

	// Last resort: return first file
	return files[0];
}

/**
 * Final fetch of subtitle file
 * @param file 
 * @returns 
 */
async function fetchSubtitleFile(file: SubtitleFile): Promise<string> {
	const res = await fetch(file.url);
	if (!res.ok) log.error(`Failed to fetch subtitle: ${file.url}`);
	return res.text();
}

/** 
 * Fetch subtitles
 * @param videoTitle 
 * @returns .srt Text File 
 */
export async function fetchSubtitle(videoTitle: string, context?: { cancelled: boolean }): Promise<string> {
	log.debug(`Fetching subtitles for: ${videoTitle}`);
	const parsed = parseVideoTitle(videoTitle);
	const meta = await lookupAnimeMetadata(parsed.title);
	const variants = generateTitleVariants(parsed, meta);

	for (const variant of variants) {
		if (context?.cancelled) {
		log.debug(`Subtitle search cancelled for ${videoTitle}`);
		return "";
		}

		log.debug(`Trying folder variant: ${variant}`);
		const html = await fetchDirPage(variant);
		if (!html) continue;

		const files = extractSubtitleFiles(html);
		if (files.length === 0) {
		log.debug(`No subtitle files found in ${variant}`);
		continue;
		}

		const match = matchSubtitleFile(files, parsed, meta);
		if (match) {
		if (!match.name.endsWith(".srt")) {
			log.debug(`Found ${match.name} (non-SRT) — archive extraction not yet supported`);
			continue;
		}

		log.debug(`Matched subtitle: ${match.name}`);
		return await fetchSubtitleFile(match);
		}
	}

	log.warn("No subtitle found for any variant");
	return "";
}

/* ──────────────────────────────────────────────────────────────
   MESSAGE HANDLER: Debounced, Cancel-safe subtitle fetch system
─────────────────────────────────────────────────────────────── */

const activeSearches = new Map<number, { cancelled: boolean }>();
let lastRequest = { title: "", timestamp: 0 };
const DEBOUNCE_MS = 1000;

/**
 * Listen for messages from content script
 */
browser.runtime.onMessage.addListener(async (msg, sender) => {
	log.debug(`Received message from ${sender.id}`, msg);

	if (msg.type !== "GET_SUBS") return;

	const tabId = sender.tab?.id ?? 0;

	// Debounce identical title within 1s
	if (msg.title === lastRequest.title && Date.now() - lastRequest.timestamp < DEBOUNCE_MS) {
		log.debug(`Skipping duplicate subtitle request for ${msg.title}`);
		return "";
	}
	lastRequest = { title: msg.title, timestamp: Date.now() };

	// Cancel previous search for this tab
	const prev = activeSearches.get(tabId);
	if (prev) prev.cancelled = true;

	const context = { cancelled: false };
	activeSearches.set(tabId, context);

	log.debug(`[${tabId}] Starting subtitle fetch for: ${msg.title}`);
	const text = await fetchSubtitle(msg.title, context);

	if (context.cancelled) {
		log.debug(`[${tabId}] Search cancelled for ${msg.title}`);
		return "";
	}

	activeSearches.delete(tabId);
	log.debug(`[${tabId}] Finished subtitle fetch, length: ${text.length}`);
	return text;
});