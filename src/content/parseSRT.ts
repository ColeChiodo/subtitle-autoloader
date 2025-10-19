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

interface Subtitle {
	start: number;
	end: number;
	text: string;
}

export function parseSRTFile(srtText: string): Subtitle[] {
	const entries: Subtitle[] = []
	const blocks = srtText.split(/\r?\n\r?\n/)

	log.debug(`Parsing SRT, total blocks: ${blocks.length}`);

	for (const block of blocks) {
		const lines = block.split(/\r?\n/).map(l => l.trim());
		if (lines.length >= 3) {
			const timeMatch = lines[1].match(/(\d+):(\d+):(\d+),(\d+)\s*-->\s*(\d+):(\d+):(\d+),(\d+)/);
			if (!timeMatch) {
				log.warn(`Skipping block with invalid timing:`, lines);
				continue;
			}

			const start = parseInt(timeMatch[1]) * 3600
						+ parseInt(timeMatch[2]) * 60
						+ parseInt(timeMatch[3])
						+ parseInt(timeMatch[4]) / 1000;

			const end = parseInt(timeMatch[5]) * 3600
						+ parseInt(timeMatch[6]) * 60
						+ parseInt(timeMatch[7])
						+ parseInt(timeMatch[8]) / 1000;

			const text = lines.slice(2).join('\n');
			entries.push({ start, end, text });
		}
	}

	log.debug(`Parsed subtitles: ${entries.length}`)
	return entries;
}
