const EXT = "[Kuraji]";

/**
 * Custom logger to prefix logs with the extension name.
 */
export const log = {
    
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
export function sanitizeFileName(rawName: string): string {
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

/**
 * Parse the input video title
 */
export function parseVideoTitle(videoTitle: string): {
    title: string;
    season?: number;
    episode?: number;
    episodeTitle?: string;
    year?: number;
} {
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