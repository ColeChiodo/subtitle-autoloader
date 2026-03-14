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

    const seMatch = videoTitle.match(/S(\d+)[\s:·\-_]*E(\d+)/i);
    const season = seMatch ? parseInt(seMatch[1]) : undefined;
    const episode = seMatch ? parseInt(seMatch[2]) : undefined;

    const epOnlyMatch = !episode ? videoTitle.match(/(?:episode|ep\.?)\s*(\d+)/i) : undefined;
    const episodeFromEp = epOnlyMatch ? parseInt(epOnlyMatch[1]) : undefined;

    let mainTitle = videoTitle;
    let episodeTitle: string | undefined;

    if (seMatch) {
        const seIndex = videoTitle.indexOf(seMatch[0]);
        if (seIndex > 0) {
            mainTitle = videoTitle.substring(0, seIndex).trim();
            const afterSe = videoTitle.substring(seIndex + seMatch[0].length).trim();
            if (afterSe) {
                episodeTitle = afterSe.replace(/\(.*?\)/g, "").trim();
            }
        }
    } else if (epOnlyMatch) {
        const epIndex = videoTitle.indexOf(epOnlyMatch[0]);
        if (epIndex > 0) {
            mainTitle = videoTitle.substring(0, epIndex).trim();
        }
    }

    mainTitle = mainTitle.replace(/\(.*?\)/g, "").trim();

    const finalEpisode = episode || episodeFromEp;

    return { title: mainTitle, season, episode: finalEpisode, episodeTitle, year };
}