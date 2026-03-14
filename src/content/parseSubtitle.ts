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

export function parseASSFile(assText: string): Subtitle[] {
	const entries: Subtitle[] = [];
	const lines = assText.split(/\r?\n/);
	
	log.debug(`Parsing ASS, total lines: ${lines.length}`);
	
	let inEvents = false;
	
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		
		if (line === '[Events]') {
			inEvents = true;
			continue;
		}
		
		if (inEvents && line.startsWith('Format:')) {
			line.substring(7).split(',').map(f => f.trim());
			continue;
		}
		
		if (inEvents && line.startsWith('Dialogue:')) {
			const parts = line.substring(9).split(',');
			if (parts.length < 10) continue;
			
			const startStr = parts[1].trim();
			const endStr = parts[2].trim();
			const textParts = parts.slice(9);
			
			const start = parseASSTime(startStr);
			const end = parseASSTime(endStr);
			
			if (start === null || end === null) {
				log.warn(`Skipping ASS line with invalid timing: ${line}`);
				continue;
			}
			
			let text = textParts.join(',');
			text = text.replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\{[^}]*\}/g, '');
			
			if (text.trim()) {
				entries.push({ start, end, text });
			}
		}
		
		if (inEvents && line.startsWith('[') && line !== '[Events]') {
			break;
		}
	}
	
	log.debug(`Parsed ASS subtitles: ${entries.length}`);
	return entries;
}

function parseASSTime(timeStr: string): number | null {
	const match = timeStr.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
	if (!match) return null;
	
	const hours = parseInt(match[1]);
	const minutes = parseInt(match[2]);
	const seconds = parseInt(match[3]);
	const centiseconds = parseInt(match[4]);
	
	return hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
}

export function parseSubtitleFile(content: string, fileName: string): Subtitle[] {
	const ext = fileName.split('.').pop()?.toLowerCase();
	
	if (ext === 'ass' || ext === 'ssa') {
		return parseASSFile(content);
	}
	
	return parseSRTFile(content);
}
