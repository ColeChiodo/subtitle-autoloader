import { Searcher } from "fast-fuzzy";
import chrome from "webextension-polyfill";
const browser_ext = typeof browser !== "undefined" ? browser : chrome;

const EXT      = "[Kuraji]";
const REPO     = "Ajatt-Tools/kitsunekko-mirror";
const BRANCH   = "main";
const API_BASE = `https://api.github.com/repos/${REPO}`;

const SUBTITLE_CATEGORIES = ["anime_movie", "anime_tv", "drama_movie", "drama_tv", "unsorted"] as const;

const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = {
    info:  (msg: string, ...a: any[]) => console.log(   `${EXT} [INFO]`,  msg, ...a),
    debug: (msg: string, ...a: any[]) => console.debug( `${EXT} [DEBUG]`, msg, ...a),
    warn:  (msg: string, ...a: any[]) => console.warn(  `${EXT} [WARN]`,  msg, ...a),
    error: (msg: string, ...a: any[]) => console.error( `${EXT} [ERROR]`, msg, ...a),
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

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface CategoryCache {
    folders: string[];   // show folder names only, e.g. ["Cowboy Bebop", "One Piece", ...]
    timestamp: number;
}

// ─── GitHub auth header ───────────────────────────────────────────────────────

async function getGitHubHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Kuraji-Extension",
    };
    try {
        const data = await browser_ext.storage.local.get("githubToken");
        const token = data.githubToken;
        if (token && /^[a-zA-Z0-9_-]+$/.test(token)) {
            headers.Authorization = "token " + token;
            log.debug("GitHub: using stored auth token");
        } else {
            log.debug("GitHub: no auth token, using unauthenticated requests (60 req/hr limit)");
        }
    } catch (err) {
        log.warn("GitHub: failed to read token from storage:", err);
    }
    return headers;
}

// ─── Category folder cache ────────────────────────────────────────────────────
//
// We use the Git Trees API at the category level to list ALL show folders.
// The Contents API is capped at 1000 entries - the Trees API is not.
// We only cache folder names (show titles), NOT subtitle files.
// Subtitle files are fetched on-demand when a match is found.
//
// API used: GET /repos/{repo}/git/trees/{branch}:{subtitles/category}
// This returns every tree/blob under that path in one shot.

const memCategoryCache = new Map<string, CategoryCache>();

async function getCachedFolders(category: string): Promise<string[] | null> {
    // 1. Memory cache (fastest)
    const mem = memCategoryCache.get(category);
    if (mem && Date.now() - mem.timestamp < CACHE_TTL_MS) {
        log.debug(`[cache:${category}] HIT (memory) - ${mem.folders.length} folders`);
        return mem.folders;
    }

    // 2. Persistent storage cache
    try {
        const stored = await browser_ext.storage.local.get("categoryCache");
        const cache: Record<string, CategoryCache> = stored.categoryCache || {};
        const entry = cache[category];
        if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
            const age = Math.round((Date.now() - entry.timestamp) / 1000 / 60);
            log.debug(`[cache:${category}] HIT (storage, ${age}m old) - ${entry.folders.length} folders`);
            memCategoryCache.set(category, entry); // warm memory
            return entry.folders;
        }
        log.debug(`[cache:${category}] MISS - will fetch from GitHub`);
    } catch (err) {
        log.warn(`[cache:${category}] Storage read error:`, err);
    }
    return null;
}

async function setCachedFolders(category: string, folders: string[]): Promise<void> {
    const entry: CategoryCache = { folders, timestamp: Date.now() };
    memCategoryCache.set(category, entry);
    try {
        const stored = await browser_ext.storage.local.get("categoryCache");
        const cache: Record<string, CategoryCache> = stored.categoryCache || {};
        cache[category] = entry;
        await browser_ext.storage.local.set({ categoryCache: cache });
        log.debug(`[cache:${category}] Saved ${folders.length} folders to storage`);
    } catch (err) {
        log.warn(`[cache:${category}] Storage write error:`, err);
    }
}

/**
 * Fetch ALL show folder names for a category using the Git Trees API.
 *
 * The Contents API (/contents/subtitles/{category}) is hard-capped at 1000 items.
 * The Trees API (/git/trees/{sha}) has no such cap for directory listings.
 *
 * Strategy:
 *   1. GET /git/trees/{branch} - repo root tree (small, ~10 entries)
 *   2. Find the sha for "subtitles/{category}"
 *   3. GET /git/trees/{sha} - all direct children (the show folders) - no page cap
 */
async function fetchCategoryFolders(category: string): Promise<string[]> {
    const cached = await getCachedFolders(category);
    if (cached) return cached;

    log.info(`[github:${category}] Fetching show folder list via Trees API...`);
    const headers = await getGitHubHeaders();

    // Step 1: get root tree to locate "subtitles" sha
    log.debug(`[github:${category}] Step 1 - fetching repo root tree`);
    const rootRes = await fetch(`${API_BASE}/git/trees/${BRANCH}`, { headers });
    if (!rootRes.ok) {
        log.error(`[github:${category}] Root tree fetch failed - HTTP ${rootRes.status}`);
        return [];
    }
    const rootData = await rootRes.json();
    const subtitlesNode = rootData.tree?.find((n: any) => n.path === "subtitles" && n.type === "tree");
    if (!subtitlesNode) {
        log.error(`[github:${category}] Could not find "subtitles" directory in root tree`);
        return [];
    }
    log.debug(`[github:${category}] Found subtitles/ sha: ${subtitlesNode.sha}`);

    // Step 2: get subtitles/ tree to locate the category sha
    log.debug(`[github:${category}] Step 2 - fetching subtitles/ tree`);
    const subtitlesRes = await fetch(`${API_BASE}/git/trees/${subtitlesNode.sha}`, { headers });
    if (!subtitlesRes.ok) {
        log.error(`[github:${category}] subtitles/ tree fetch failed - HTTP ${subtitlesRes.status}`);
        return [];
    }
    const subtitlesData = await subtitlesRes.json();
    const categoryNode = subtitlesData.tree?.find((n: any) => n.path === category && n.type === "tree");
    if (!categoryNode) {
        log.error(`[github:${category}] Category not found in subtitles/ tree. Available: ${subtitlesData.tree?.map((n: any) => n.path).join(", ")}`);
        return [];
    }
    log.debug(`[github:${category}] Found ${category}/ sha: ${categoryNode.sha}`);

    // Step 3: get all direct children of the category - these are the show folders
    log.debug(`[github:${category}] Step 3 - fetching all show folders (no 1000-item cap)`);
    const categoryRes = await fetch(`${API_BASE}/git/trees/${categoryNode.sha}`, { headers });
    if (!categoryRes.ok) {
        log.error(`[github:${category}] Category tree fetch failed - HTTP ${categoryRes.status}`);
        return [];
    }
    const categoryData = await categoryRes.json();

    if (categoryData.truncated) {
        // This would require >100k entries - effectively impossible for a subtitle mirror
        log.warn(`[github:${category}] Tree was truncated by GitHub (>100k entries) - some shows may be missing`);
    }

    const folders: string[] = (categoryData.tree as any[])
        .filter((n: any) => n.type === "tree")
        .map((n: any) => n.path);

    log.info(`[github:${category}] Found ${folders.length} show folders (was previously capped at 1000)`);
    await setCachedFolders(category, folders);
    return folders;
}

// ─── On-demand subtitle file fetching ────────────────────────────────────────
//
// Once we know the show folder, fetch its contents via the Contents API.
// This is fine because individual shows rarely have >1000 subtitle files.
// (One Piece is an edge case - handled by recursion with depth guard.)

async function fetchSubtitleFilesInFolder(
    category: string,
    folder: string,
    depth = 0,
    maxDepth = 3
): Promise<SubtitleFile[]> {
    const path = `subtitles/${category}/${folder}`;
    log.debug(`[files] Fetching contents of ${path} (depth ${depth})`);

    const headers = await getGitHubHeaders();
    const res = await fetch(`${API_BASE}/contents/${path}`, { headers });

    if (!res.ok) {
        log.error(`[files] Contents fetch failed for ${path} - HTTP ${res.status}`);
        return [];
    }

    const items: any[] = await res.json();
    log.debug(`[files] ${path} - ${items.length} items`);

    const files: SubtitleFile[] = [];

    for (const item of items) {
        if (item.type === "file") {
            const ext = item.name.split(".").pop()?.toLowerCase();
            if (ext === "srt" || ext === "ass") {
                files.push({ name: item.name, url: item.download_url, extension: ext });
                log.debug(`[files]   + ${item.name}`);
            }
        } else if (item.type === "dir" && depth < maxDepth) {
            // Recurse into subdirectories (e.g. One Piece season folders)
            const subPath = item.path.replace(/^subtitles\//, "");
            log.debug(`[files]   -> recursing into subdir: ${item.name}`);
            const subFiles = await fetchSubtitleFilesInFolder(
                subPath.split("/")[0],              // category
                subPath.split("/").slice(1).join("/"), // folder/subpath
                depth + 1,
                maxDepth
            );
            files.push(...subFiles);
        }
    }

    log.debug(`[files] Total subtitle files found under ${path}: ${files.length}`);
    return files;
}

// ─── Title parsing ────────────────────────────────────────────────────────────

export function parseVideoTitle(videoTitle: string): ParsedTitle {
    log.debug(`[parse] Input: "${videoTitle}"`);

    const yearMatch = videoTitle.match(/\((\d{4})\)/);
    const year      = yearMatch ? parseInt(yearMatch[1]) : undefined;

    const seMatch = videoTitle.match(/S(\d+)[\s:]*E(\d+)/i);
    const season  = seMatch ? parseInt(seMatch[1]) : undefined;
    const episode = seMatch ? parseInt(seMatch[2]) : undefined;

    const parts     = videoTitle.split(" - ").map((p) => p.trim()).filter(Boolean);
    const mainTitle = parts[0]?.replace(/\(.*?\)/g, "").trim() || videoTitle.trim();

    let episodeTitle: string | undefined;
    if (seMatch && parts.length > 2) {
        episodeTitle = parts.slice(2).join(" - ").replace(/\(.*?\)/g, "").trim();
    } else if (parts.length > 1) {
        episodeTitle = parts.slice(1).join(" - ").replace(/\(.*?\)/g, "").trim();
    }

    const result = { title: mainTitle, season, episode, episodeTitle, year };
    log.debug(`[parse] Result:`, result);
    return result;
}

// ─── AniList metadata ─────────────────────────────────────────────────────────

export async function lookupAnimeMetadata(title: string): Promise<AnimeMetadata> {
    log.debug(`[anilist] Querying for: "${title}"`);
    const query = `
        query ($search: String) {
            Media(search: $search, type: ANIME) {
                title { english romaji native }
                synonyms
                idMal
            }
        }
    `;
    const res = await fetch("https://graphql.anilist.co", {
        method:  "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body:    JSON.stringify({ query, variables: { search: title } }),
    });
    if (!res.ok) {
        log.warn(`[anilist] Request failed - HTTP ${res.status}`);
        return {};
    }
    const json  = await res.json();
    const media = json.data?.Media;
    if (!media) {
        log.warn(`[anilist] No result found for: "${title}"`);
        return {};
    }
    const meta: AnimeMetadata = {
        english:  media.title.english  ?? undefined,
        romaji:   media.title.romaji   ?? undefined,
        native:   media.title.native   ?? undefined,
        synonyms: media.synonyms || [],
        malId:    media.idMal    ?? undefined,
    };
    log.debug(`[anilist] Found:`, {
        english: meta.english,
        romaji:  meta.romaji,
        malId:   meta.malId,
        synonyms: meta.synonyms?.length,
    });
    return meta;
}

// ─── Title variant generation ─────────────────────────────────────────────────

export function generateTitleVariants(parsed: ParsedTitle, meta: AnimeMetadata): string[] {
    const out = new Set<string>();
    const add = (s?: string) => {
        if (!s) return;
        const b = s.trim();
        out.add(b);
        out.add(b.replace(/\s+/g, "+"));
        out.add(b.replace(/\s+/g, "."));
        out.add(b.replace(/\s+/g, "_"));
        out.add(b.toLowerCase());
        if (b.length > 1) out.add(b.slice(0, -1));
    };
    add(parsed.title);
    add(meta.english);
    add(meta.romaji);
    add(meta.native);
    meta.synonyms?.forEach(add);
    const variants = Array.from(out);
    log.debug(`[variants] Generated ${variants.length} variants from "${parsed.title}":`, variants);
    return variants;
}

// ─── Folder matching ──────────────────────────────────────────────────────────

interface FolderMatch {
    name: string;
    category: string;
    matchType: "exact" | "substring" | "fuzzy";
}

/**
 * Find the best matching show folder across all categories.
 * Tries exact -> substring -> fuzzy, in that order.
 * Returns the first strong match found.
 */
async function findBestFolderMatch(
    variants: string[],
    category?: string
): Promise<FolderMatch | null> {
    const categories = category ? [category] : [...SUBTITLE_CATEGORIES];
    log.debug(`[match] Searching ${categories.length} categories with ${variants.length} variants`);

    // Pre-fetch all category folder lists (uses cache)
    const foldersByCategory = new Map<string, string[]>();
    for (const cat of categories) {
        const folders = await fetchCategoryFolders(cat);
        foldersByCategory.set(cat, folders);
        log.debug(`[match:${cat}] ${folders.length} folders available`);
    }

    // Pass 1: exact match
    log.debug(`[match] Pass 1 - exact match`);
    for (const variant of variants) {
        const term = variant.toLowerCase();
        for (const [cat, folders] of foldersByCategory) {
            const hit = folders.find((f) => f.toLowerCase() === term);
            if (hit) {
                log.info(`[match] EXACT match: "${hit}" in ${cat} (variant: "${variant}")`);
                return { name: hit, category: cat, matchType: "exact" };
            }
        }
    }

    // Pass 2: substring match (either direction)
    log.debug(`[match] Pass 2 - substring match`);
    for (const variant of variants) {
        const term = variant.toLowerCase();
        for (const [cat, folders] of foldersByCategory) {
            const hit = folders.find(
                (f) => f.toLowerCase().includes(term) || term.includes(f.toLowerCase())
            );
            if (hit) {
                log.info(`[match] SUBSTRING match: "${hit}" in ${cat} (variant: "${variant}")`);
                return { name: hit, category: cat, matchType: "substring" };
            }
        }
    }

    // Pass 3: fuzzy match on primary variant
    log.debug(`[match] Pass 3 - fuzzy match (primary variant: "${variants[0]}")`);
    for (const [cat, folders] of foldersByCategory) {
        const lowered  = folders.map((f) => f.toLowerCase());
        const searcher = new Searcher(lowered, { threshold: 0.5 });
        const results  = searcher.search(variants[0].toLowerCase());
        if (results.length > 0) {
            const idx = lowered.indexOf(results[0]);
            if (idx >= 0) {
                log.info(`[match] FUZZY match: "${folders[idx]}" in ${cat} (score threshold 0.5)`);
                return { name: folders[idx], category: cat, matchType: "fuzzy" };
            }
        }
    }

    log.warn(`[match] No folder match found for variants:`, variants.slice(0, 5));
    return null;
}

// ─── Subtitle file matching ───────────────────────────────────────────────────

async function getAllEpisodesMAL(malId: number): Promise<{ number: number; title: string }[]> {
    log.debug(`[mal] Fetching episode list for MAL ID ${malId}`);
    const episodes: { number: number; title: string }[] = [];
    let page = 1;
    let more  = true;
    while (more) {
        const res  = await fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`);
        const json = await res.json();
        const batch = json.data.map((ep: any) => ({ number: ep.mal_id, title: ep.title }));
        episodes.push(...batch);
        log.debug(`[mal] Page ${page}: ${batch.length} episodes (total: ${episodes.length})`);
        more = !!json.pagination.has_next_page;
        page++;
    }
    log.debug(`[mal] Done - ${episodes.length} total episodes`);
    return episodes;
}

async function matchSubtitleFile(
    files: SubtitleFile[],
    parsed: ParsedTitle,
    meta: AnimeMetadata
): Promise<SubtitleFile | null> {
    log.debug(`[subtitle-match] ${files.length} candidates, episode: S${parsed.season ?? "?"}E${parsed.episode ?? "?"}`);

    if (files.length === 0) return null;

    // S+E direct match
    if (parsed.season && parsed.episode) {
        const re  = new RegExp(`S0*${parsed.season}E0*${parsed.episode}(?!\\d)`, "i");
        const hit = files.find((f) => re.test(f.name));
        if (hit) {
            log.info(`[subtitle-match] S+E direct match: "${hit.name}"`);
            return hit;
        }
        log.debug(`[subtitle-match] No S+E direct match for S${parsed.season}E${parsed.episode}`);
    }

    // Episode-only match
    if (!parsed.season && parsed.episode) {
        const re  = new RegExp(`(?:S\\d+E)?0*${parsed.episode}(?!\\d)`, "i");
        const hit = files.find((f) => re.test(f.name));
        if (hit) {
            log.info(`[subtitle-match] Episode-only match: "${hit.name}"`);
            return hit;
        }
        log.debug(`[subtitle-match] No episode-only match for E${parsed.episode}`);
    }

    // Episode title via MAL
    if (parsed.episodeTitle && meta.malId) {
        log.debug(`[subtitle-match] Trying MAL episode title match for: "${parsed.episodeTitle}"`);
        const eps      = await getAllEpisodesMAL(meta.malId);
        const epMatch  = eps.find((ep) =>
            ep.title?.toLowerCase().includes(parsed.episodeTitle!.toLowerCase())
        );
        if (epMatch) {
            log.debug(`[subtitle-match] MAL episode title matched: #${epMatch.number} "${epMatch.title}"`);
            const re  = new RegExp(`(?:S0*\\d+)?(?:E0*)?${epMatch.number}(?!\\d)`, "i");
            const hit = files.find((f) => re.test(f.name));
            if (hit) {
                log.info(`[subtitle-match] MAL episode title -> file match: "${hit.name}"`);
                return hit;
            }
        } else {
            log.debug(`[subtitle-match] MAL episode title not found for: "${parsed.episodeTitle}"`);
        }
    }

    // Language-preference scoring
    const score = (name: string): number => {
        const n = name.toLowerCase();
        let s = 0;
        if      (n.includes("jpn") || n.includes("jap")) s = 100;
        else if (n.includes("eng"))                       s = 50;
        else if (n.includes("chs") || n.includes("chn")) s = 10;
        else if (n.includes("cht") || n.includes("big5")) s = 5;
        s += (10 - name.split("/").length) * 2; // shallower = better
        return s;
    };

    const scored = [...files].sort((a, b) => score(b.name) - score(a.name));
    log.debug(`[subtitle-match] Top scored files:`,
        scored.slice(0, 5).map((f) => ({ name: f.name, score: score(f.name) }))
    );
    log.info(`[subtitle-match] Fallback to best-scored: "${scored[0].name}"`);
    return scored[0];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchSubtitle(
    videoTitle: string,
    context?: { cancelled: boolean },
    category?: string
): Promise<{ text: string; fileName: string | null; extension: string | null }> {
    log.info(`[fetchSubtitle] > title: "${videoTitle}", category: ${category ?? "all"}`);

    const parsed = parseVideoTitle(videoTitle);
    log.debug(`[fetchSubtitle] Parsed title: "${parsed.title}", S${parsed.season}E${parsed.episode}`);

    const meta = await lookupAnimeMetadata(parsed.title);
    const hasEntry = meta && (meta.english || meta.romaji || meta.native || (meta.synonyms?.length ?? 0) > 0);
    if (!hasEntry) {
        log.warn(`[fetchSubtitle] No AniList entry found for "${parsed.title}" - aborting`);
        return { text: "Kuraji -「クラジ」", fileName: null, extension: null };
    }

    if (context?.cancelled) {
        log.debug(`[fetchSubtitle] Cancelled before folder search`);
        return { text: "", fileName: null, extension: null };
    }

    const variants   = generateTitleVariants(parsed, meta);
    const bestFolder = await findBestFolderMatch(variants, category);

    if (!bestFolder) {
        log.warn(`[fetchSubtitle] No folder matched for "${parsed.title}"`);
        return { text: "", fileName: null, extension: null };
    }
    log.info(`[fetchSubtitle] Matched folder: "${bestFolder.name}" in ${bestFolder.category} (${bestFolder.matchType})`);

    if (context?.cancelled) {
        log.debug(`[fetchSubtitle] Cancelled before file fetch`);
        return { text: "", fileName: null, extension: null };
    }

    const files = await fetchSubtitleFilesInFolder(bestFolder.category, bestFolder.name);
    log.info(`[fetchSubtitle] ${files.length} subtitle files found in folder`);

    const match = await matchSubtitleFile(files, parsed, meta);
    if (!match) {
        log.warn(`[fetchSubtitle] No subtitle file matched for S${parsed.season}E${parsed.episode}`);
        return { text: "", fileName: null, extension: null };
    }
    log.info(`[fetchSubtitle] OK Fetching: "${match.name}" from ${match.url}`);

    const res = await fetch(match.url);
    if (!res.ok) {
        log.error(`[fetchSubtitle] Failed to download subtitle - HTTP ${res.status}: ${match.url}`);
        return { text: "", fileName: null, extension: null };
    }

    log.info(`[fetchSubtitle] OK Done for "${videoTitle}"`);
    return { text: await res.text(), fileName: match.name, extension: match.extension };
}

export async function searchFolders(
    videoTitle: string,
    category?: string
): Promise<{ matches: { folder: string; category: string }[] }> {
    log.info(`[searchFolders] title: "${videoTitle}", category: ${category ?? "all"}`);

    const parsed    = parseVideoTitle(videoTitle);
    const meta      = await lookupAnimeMetadata(parsed.title);
    if (!meta) return { matches: [] };

    const variants   = generateTitleVariants(parsed, meta);
    const categories = category ? [category] : [...SUBTITLE_CATEGORIES];

    const seen    = new Set<string>();
    const matches: { folder: string; category: string }[] = [];

    for (const cat of categories) {
        const folders = await fetchCategoryFolders(cat);
        for (const variant of variants) {
            const term = variant.toLowerCase();
            for (const f of folders) {
                const key = `${cat}/${f}`;
                if (seen.has(key)) continue;
                if (f.toLowerCase().includes(term) || term.includes(f.toLowerCase())) {
                    seen.add(key);
                    matches.push({ folder: f, category: cat });
                    log.debug(`[searchFolders] match: ${key} (variant: "${variant}")`);
                }
            }
        }
    }

    // Fuzzy fallback
    if (matches.length === 0 && variants.length > 0) {
        log.debug(`[searchFolders] No substring matches - trying fuzzy fallback`);
        for (const cat of categories) {
            const folders  = await fetchCategoryFolders(cat);
            const lowered  = folders.map((f) => f.toLowerCase());
            const searcher = new Searcher(lowered, { threshold: 0.4 });
            for (const hit of searcher.search(variants[0].toLowerCase())) {
                const idx = lowered.indexOf(hit);
                if (idx >= 0) {
                    matches.push({ folder: folders[idx], category: cat });
                    log.debug(`[searchFolders] fuzzy match: ${cat}/${folders[idx]}`);
                }
            }
        }
    }

    log.info(`[searchFolders] ${matches.length} matches found`);
    return { matches: matches.slice(0, 10) };
}

export async function getFilesInFolder(
    category: string,
    folder: string
): Promise<{ files: { name: string; url: string; extension: string }[] }> {
    log.info(`[getFilesInFolder] ${category}/${folder}`);
    const files = await fetchSubtitleFilesInFolder(category, folder);
    log.info(`[getFilesInFolder] ${files.length} files returned`);
    return { files };
}

export async function fetchSubtitleByUrl(
    url: string,
    fileName: string
): Promise<{ text: string; fileName: string; extension: string }> {
    log.debug(`[fetchSubtitleByUrl] ${url}`);
    const res  = await fetch(url);
    const text = res.ok ? await res.text() : "";
    if (!res.ok) log.error(`[fetchSubtitleByUrl] Failed - HTTP ${res.status}`);
    return { text, fileName, extension: fileName.split(".").pop() || "srt" };
}

// ─── Message handler ──────────────────────────────────────────────────────────

const activeSearches = new Map<number, { cancelled: boolean }>();
let   lastRequest    = { title: "", timestamp: 0 };
const DEBOUNCE_MS    = 1000;

async function handleMessage(msg: any, sender: any) {
    log.debug(`[msg] Received type: ${msg.type}`);

    switch (msg.type) {
        case "CLEAR_CACHE": {
            memCategoryCache.clear();
            try {
                await browser_ext.storage.local.remove("categoryCache");
                log.info("[msg:CLEAR_CACHE] Cache cleared (memory + storage)");
                return { success: true };
            } catch (err) {
                log.error("[msg:CLEAR_CACHE] Failed:", err);
                return { success: false };
            }
        }
        case "SEARCH_FOLDERS":  return searchFolders(msg.title, msg.category);
        case "GET_FILES":       return getFilesInFolder(msg.category, msg.folder);
        case "GET_SUBS_BY_URL": return fetchSubtitleByUrl(msg.url, msg.fileName);
        case "LOG_DEBUG":       log.debug("[msg:LOG_DEBUG]", msg.message); return { text: "", fileName: null, extension: null };
        case "GET_SUBS":        break;
        default:
            log.warn(`[msg] Unknown message type: ${msg.type}`);
            return { text: "", fileName: null, extension: null };
    }

    // GET_SUBS
    const tabId = sender.tab?.id ?? 0;
    log.debug(`[msg:GET_SUBS] tabId=${tabId}, title="${msg.title}"`);

    if (msg.title === lastRequest.title && Date.now() - lastRequest.timestamp < DEBOUNCE_MS) {
        log.debug(`[msg:GET_SUBS] Debounced - same title within ${DEBOUNCE_MS}ms`);
        return { text: "", fileName: null, extension: null };
    }
    lastRequest = { title: msg.title, timestamp: Date.now() };

    const prev = activeSearches.get(tabId);
    if (prev) {
        log.debug(`[msg:GET_SUBS] Cancelling previous search for tabId=${tabId}`);
        prev.cancelled = true;
    }

    const context = { cancelled: false };
    activeSearches.set(tabId, context);

    const result = await fetchSubtitle(msg.title, context, msg.category);

    if (context.cancelled) {
        log.debug(`[msg:GET_SUBS] Search was cancelled for tabId=${tabId}`);
        return { text: "", fileName: null, extension: null };
    }

    activeSearches.delete(tabId);
    return result;
}

browser_ext.runtime.onMessage.addListener(
    (msg: any, sender: any, sendResponse: (r?: any) => void): true => {
        (async () => {
            try {
                sendResponse(await handleMessage(msg, sender));
            } catch (err) {
                log.error("[msg] Unhandled error in message handler:", err);
                sendResponse({ text: "", fileName: null, extension: null });
            }
        })();
        return true;
    }
);
