const browser_ext = typeof browser !== "undefined" ? browser : chrome;

let fileNameEl: HTMLDivElement | null = null;

const API_URL = 'https://o6xssbovz7.execute-api.us-west-1.amazonaws.com/dev/explain';

let llmApiKey: string | null = null;

async function checkLlmApiKey(): Promise<boolean> {
    if (llmApiKey !== null) return !!llmApiKey;
    try {
        const stored = await browser_ext.storage.local.get('llmApiKey');
        llmApiKey = stored.llmApiKey || null;
    } catch {
        llmApiKey = null;
    }
    return !!llmApiKey;
}

const SUBTITLE_CATEGORIES = [
    { value: "", label: "All Categories" },
    { value: "anime_tv", label: "TV Anime" },
    { value: "anime_movie", label: "Movie Anime" },
    { value: "drama_tv", label: "TV Drama" },
    { value: "drama_movie", label: "Movie Drama" },
    { value: "unsorted", label: "Unsorted" },
];

/**
 * Create subtitle overlay
 */
export function initSubtitles(defaults: { subs: boolean; overlayParent?: HTMLElement | null; }) {
    if (document.querySelector('.kuraji-subtitles')) return null;

    const overlay = createOverlay();
    const span = createSubtitleSpan();

    overlay.appendChild(span);
    (defaults.overlayParent || document.body).appendChild(overlay);
    overlay.style.display = defaults.subs ? 'flex' : 'none';

    return overlay;
}

function createOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.classList.add('kuraji-subtitles');
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: '999999999',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
    });
    return overlay;
}

function createSubtitleSpan(): HTMLSpanElement {
    const container = document.createElement('span');
    Object.assign(container.style, {
        position: 'absolute',
        background: 'rgba(0,0,0,0.5)',
        padding: '2px 6px',
        color: 'white',
        fontSize: '25px',
        textShadow: '2px 2px 4px black',
        cursor: 'move',
        pointerEvents: 'all',
        userSelect: 'none',
        display: 'none'
    });

    const textSpan = document.createElement('span');
    textSpan.className = 'subtitle-text';
    container.appendChild(textSpan);

    let explainIcon: HTMLSpanElement | null = null;

    const observer = new MutationObserver(() => {
        const text = textSpan.textContent || '';
        const hasContent = text.trim() !== '';
        container.style.display = hasContent ? 'inline-block' : 'none';
    });

    observer.observe(textSpan, { characterData: true, childList: true, subtree: true });

    (async () => {
        const hasApiKey = await checkLlmApiKey();
        if (!hasApiKey) return;

        explainIcon = document.createElement('span');
        explainIcon.innerHTML = '&#9432;';
        explainIcon.className = 'explain-icon';
        Object.assign(explainIcon.style, {
            display: 'inline-block',
            marginLeft: '8px',
            cursor: 'pointer',
            opacity: '0',
            transition: 'opacity 0.2s',
            fontSize: '20px',
            verticalAlign: 'middle',
            pointerEvents: 'auto'
        });
        explainIcon.title = 'Explain grammar';
        container.appendChild(explainIcon);

        explainIcon.addEventListener('click', async (e) => {
            e.stopPropagation();
            const sentence = textSpan.textContent?.trim();
            if (!sentence || !explainIcon) return;

            const modal = createExplainModal();
            document.body.appendChild(modal);
            showLoading(modal);

            try {
                const { loadLlmApiKey } = await import('./storage');
                const apiKey = await loadLlmApiKey();

                if (!apiKey) {
                    showError(modal, 'Please set your LLM API key in the extension settings.');
                    return;
                }

                const res = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: apiKey, sentence }),
                });

                const raw = await res.text();
                let data;
                try {
                    data = JSON.parse(raw);
                } catch {
                    const fixed = raw.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');
                    data = JSON.parse(fixed);
                }

                if (!res.ok) {
                    showError(modal, data.body?.error || data.error || 'Request failed');
                    return;
                }

                if (data.body?.body && typeof data.body.body === 'string') {
                    data = JSON.parse(data.body.body);
                } else if (data.body && typeof data.body === 'object') {
                    data = data.body;
                }

                showResult(modal, data, sentence);
            } catch (err: any) {
                showError(modal, err.message);
            }
        });

        container.addEventListener('mouseenter', () => {
            const text = textSpan.textContent || '';
            if (text.trim() && explainIcon) {
                explainIcon.style.opacity = '1';
            }
        });

        container.addEventListener('mouseleave', () => {
            if (explainIcon) {
                explainIcon.style.opacity = '0';
            }
        });
    })();

    makeDraggable(container);

    return container;
}

function createExplainModal(): HTMLDivElement {
    const modal = document.createElement('div');
    Object.assign(modal.style, {
        position: 'fixed',
        top: '100px',
        left: '100px',
        width: '500px',
        background: '#1e1e1e',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        zIndex: '9999999999',
        fontFamily: 'Arial, sans-serif',
        overflow: 'hidden'
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
        background: '#2d2d2d',
        color: '#e0e0e0',
        padding: '12px 16px',
        cursor: 'move',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
    });

    const title = document.createElement('span');
    title.textContent = 'Grammar Explanation';
    title.style.fontWeight = 'bold';

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    Object.assign(closeBtn.style, {
        background: 'none',
        border: 'none',
        fontSize: '20px',
        cursor: 'pointer',
        color: 'white'
    });
    closeBtn.addEventListener('click', () => modal.remove());

    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const content = document.createElement('div');
    Object.assign(content.style, {
        padding: '16px',
        maxHeight: '300px',
        overflow: 'auto',
        color: '#e0e0e0'
    });
    modal.appendChild(content);

    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    header.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragOffsetX = e.clientX - modal.offsetLeft;
        dragOffsetY = e.clientY - modal.offsetTop;
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        modal.style.left = `${e.clientX - dragOffsetX}px`;
        modal.style.top = `${e.clientY - dragOffsetY}px`;
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    return modal;
}

function showLoading(modal: HTMLDivElement) {
    const content = modal.children[1] as HTMLElement;
    content.innerHTML = '<p style="text-align:center;color:#666;">Loading explanation...</p>';
}

function showError(modal: HTMLDivElement, message: string) {
    const content = modal.children[1] as HTMLElement;
    content.innerHTML = `<p style="color:#c00;text-align:center;">${message}</p>`;
}

function showResult(modal: HTMLDivElement, data: any, sentence: string) {
    const content = modal.children[1] as HTMLElement;

    content.innerHTML = `
        <style>
            .explain-original { font-size: 18px; margin-bottom: 12px; padding: 12px; background: #2d2d2d; border-radius: 6px; color: #fff; font-weight: 500; }
            .explain-translation { font-size: 18px; margin-bottom: 16px; padding: 12px; background: #2d2d2d; border-radius: 6px; color: #b0b0b0; font-weight: 500; }
            .explain-breakdown { list-style: none; padding: 0; margin: 0; }
            .explain-breakdown li { padding: 8px 0; border-bottom: 1px solid #444; }
            .explain-word { font-weight: 600; color: #fff; }
            .explain-type { color: #888; font-size: 14px; }
            .explain-meaning { color: #b0b0b0; font-size: 14px; margin-top: 4px; }
        </style>
        <div class="explain-original">${sentence}</div>
        <div class="explain-translation">${data.translation || ''}</div>
        <ul class="explain-breakdown">
            ${(data.breakdown || []).map((b: any) => `
                <li>
                    <span class="explain-word">${b.word}</span>
                    <span class="explain-type">(${b.type})</span>
                    <div class="explain-meaning">${b.meaning}</div>
                </li>
            `).join('')}
        </ul>
    `;
}

function makeDraggable(span: HTMLElement) {
    let isDragging = false, offsetX = 0, offsetY = 0;

    span.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - span.offsetLeft;
        offsetY = e.clientY - span.offsetTop;
        document.body.style.userSelect = 'none';
        e.preventDefault();
        e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        span.style.left = `${e.clientX - offsetX}px`;
        span.style.top = `${e.clientY - offsetY}px`;
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        document.body.style.userSelect = '';
    });
}

/**
 * Create the menu button
 * @param parent - Where to insert the button
 * @param defaults - Default values from settings and search query
 * @param toggleCallback - Function that is called when settings are changed
 * @param searchCallback - Function that is called when search is started
 */
export function createMenu(
    parent: HTMLElement,
    defaults: { subs: boolean; offset: number; color: string; fontSize: number; search: { title?: string; season?: number; episode?: number; episodeTitle?: string; }; },
    toggleCallback: (subs: boolean, offset: number, color: string, fontSize: number) => void,
    searchCallback: (searchquery: { animeTitle: string; season?: string; episodeNumber?: string; episodeTitle?: string; category?: string; subtitleText?: string; subtitleFileName?: string; subtitleExtension?: string; }) => void
) {
    if (document.querySelector('.kuraji-menu-button')) return;

    let state = {
        subtitleColor: defaults.color,
        subtitleOffset: defaults.offset,
        subtitleFontSize: defaults.fontSize,
        toggleState: defaults.subs
    };

    const button = createMenuButton();
    const dropdown = createDropdown(state, defaults, toggleCallback, searchCallback);

    button.appendChild(dropdown);
    setupButtonToggle(button, dropdown);

    const referenceNode = parent.children[3]; // index where button is inserted
    parent.insertBefore(button, referenceNode);

    return button;
}

function createMenuButton(): HTMLDivElement {
    const button = document.createElement('div');
    button.classList.add('kuraji-menu-button');
    Object.assign(button.style, {
        width: '40px',
        height: '40px',
        cursor: 'pointer',
        zIndex: '999999999',
        backgroundImage: `url(${browser_ext.runtime.getURL('/assets/icons/cc-icon-white.png')})`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        userSelect: 'none',
        display: 'inline-block',
        borderRadius: '50%',
        position: 'relative'
    });
    return button;
}

function createDropdown(
    state: { subtitleColor: string; subtitleOffset: number; subtitleFontSize: number; toggleState: boolean },
    defaults: any,
    toggleCallback: Function,
    searchCallback: (query: {
        animeTitle: string;
        season?: string;
        episodeNumber?: string;
        episodeTitle?: string;
        category?: string;
    }) => void
): HTMLDivElement {
    const dropdown = document.createElement('div');
    Object.assign(dropdown.style, {
        position: 'absolute',
        bottom: '50px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.9)',
        color: 'white',
        padding: '12px',
        borderRadius: '8px',
        display: 'none',
        minWidth: '240px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        gap: '0',
        margin: '0',
        lineHeight: 'normal',
        letterSpacing: 'normal',
        boxSizing: 'border-box',
    });
    dropdown.addEventListener('click', (e) => e.stopPropagation());

    dropdown.append(
        createSearchForm(defaults, searchCallback),
        createFileNameEl(),
        createToggle(state, toggleCallback),
        createOffsetControls(state, toggleCallback),
        createColorPicker(state, toggleCallback),
        createFontSizeControls(state, toggleCallback)
    );

    return dropdown;
}

function createSearchForm(
    defaults: any,
    searchCallback: (query: {
        animeTitle: string;
        season?: string;
        episodeNumber?: string;
        episodeTitle?: string;
        category?: string;
    }) => void
): HTMLFormElement {
    const form = document.createElement('form');
    Object.assign(form.style, { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' });

    const browser_ext = typeof browser !== "undefined" ? browser : chrome;

    const makeInput = (defaultValue: string, placeholder: string, name: string, required = false) => {
        const input = document.createElement('input');
        input.value = defaultValue;
        input.placeholder = placeholder;
        input.name = name;
        input.required = required;
        Object.assign(input.style, {
            padding: '4px 6px',
            borderRadius: '4px',
            border: '1px solid #444',
            background: '#111',
            color: 'white',
            fontSize: '13px'
        });
        ['keydown','keyup','keypress'].forEach(ev => input.addEventListener(ev, e => e.stopPropagation()));
        input.setAttribute('autocomplete', 'off');
        return input;
    };

    const makeSelect = (name: string) => {
        const select = document.createElement('select');
        select.name = name;
        Object.assign(select.style, {
            padding: '4px 6px',
            borderRadius: '4px',
            border: '1px solid #444',
            background: '#111',
            color: 'white',
            fontSize: '13px'
        });
        ['keydown','keyup','keypress'].forEach(ev => select.addEventListener(ev, e => e.stopPropagation()));
        return select;
    };

    const categorySelect = makeSelect('category');
    SUBTITLE_CATEGORIES.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.value;
        option.textContent = cat.label;
        categorySelect.appendChild(option);
    });

    const titleInput = makeInput(defaults.search.title || '', 'Anime title *', 'animeTitle', true);
    const seasonInput = makeInput(defaults.search.season?.toString() || '', 'Season (optional)', 'season');
    const episodeInput = makeInput(defaults.search.episode?.toString() || '', 'Episode # (optional)', 'episodeNumber');
    const epTitleInput = makeInput(defaults.search.episodeTitle || '', 'Episode title (optional)', 'episodeTitle');

    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.textContent = 'Search';
    Object.assign(searchBtn.style, {
        background: '#4caf50', color: 'white', border: 'none', borderRadius: '4px',
        padding: '6px 0', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', marginTop: '2px'
    });

    const folderSelect = makeSelect('folder');
    folderSelect.style.display = 'none';
    const folderOption = document.createElement('option');
    folderOption.value = '';
    folderOption.textContent = 'Select folder...';
    folderSelect.appendChild(folderOption);

    const fileSelect = makeSelect('file');
    fileSelect.style.display = 'none';
    const fileOption = document.createElement('option');
    fileOption.value = '';
    fileOption.textContent = 'Select file...';
    fileSelect.appendChild(fileOption);

    form.append(categorySelect, titleInput, seasonInput, episodeInput, epTitleInput, searchBtn);
    form.append(folderSelect, fileSelect);

    let selectedFolder: { folder: string; category: string } | null = null;
    let selectedFile: { name: string; url: string; extension: string } | null = null;

    function filterFiles(files: { name: string; url: string; extension: string }[]): { name: string; url: string; extension: string }[] {
        const season = seasonInput.value.trim();
        const episode = episodeInput.value.trim();
        const episodeTitle = epTitleInput.value.trim().toLowerCase();

        if (!season && !episode && !episodeTitle) {
            return files;
        }

        const filtered = files.filter(file => {
            const fileName = file.name.toLowerCase();

            if (episode) {
                const epNum = episode.replace(/^0+/, '') || '0';
                const epRegex = new RegExp(`(?:s\\d+[e_\\-.]?|s\\d+[_\\-. ]?|season[_\\- ]?\\d+[_\\- ]?e?|e)${epNum}(?:\\.|_|-|$|\\s)`, 'i');
                if (!epRegex.test(fileName)) {
                    return false;
                }
            }

            if (season) {
                const seasonNum = season.replace(/^0+/, '') || '0';
                const seasonRegex = new RegExp(`s${seasonNum}e\\d+|2nd\\s+season.*-${seasonNum.padStart(2, '0')}|season[_\\- ]?${seasonNum}[_\\- ]|season[_\\- ]?${seasonNum}`, 'i');
                if (episode && !seasonRegex.test(fileName)) {
                    return false;
                }
            }

            return true;
        });

        return filtered.length > 0 ? filtered : files;
    }

    searchBtn.addEventListener('click', async () => {
        const animeTitle = titleInput.value.trim();
        const season = seasonInput.value.trim();
        const episode = episodeInput.value.trim();
        const episodeTitle = epTitleInput.value.trim();
        
        if (fileNameEl) fileNameEl.textContent = 'Searching folders...';
        if (!animeTitle) { alert('Anime title is required.'); return; }

        const category = categorySelect.value || undefined;

        let searchTitle = animeTitle;
        if (season && episode) {
            searchTitle += ` S${season}E${episode}`;
        } else if (episode) {
            searchTitle += ` E${episode}`;
        }
        if (episodeTitle) {
            searchTitle += ` ${episodeTitle}`;
        }

        try {
            const result = await (browser_ext.runtime.sendMessage as (msg: any) => Promise<any>)({
                type: "SEARCH_FOLDERS",
                title: searchTitle,
                category: category,
            });

            const matches = result.matches || [];
            
            if (matches.length === 0) {
                if (fileNameEl) fileNameEl.textContent = 'No folders found';
                folderSelect.style.display = 'none';
                fileSelect.style.display = 'none';
                return;
            }

            folderSelect.innerHTML = '';
            const defaultOpt = document.createElement('option');
            defaultOpt.value = '';
            defaultOpt.textContent = matches.length > 1 ? `Change folder (${matches.length} found)` : matches[0].folder;
            folderSelect.appendChild(defaultOpt);

            matches.forEach((match: { folder: string; category: string }) => {
                const opt = document.createElement('option');
                opt.value = JSON.stringify(match);
                opt.textContent = `${match.folder} [${match.category}]`;
                folderSelect.appendChild(opt);
            });

            folderSelect.style.display = 'block';
            
            // Auto-select first folder
            selectedFolder = matches[0];
            folderSelect.selectedIndex = 1;
            
            if (!selectedFolder) return;
            
            if (fileNameEl) fileNameEl.textContent = 'Loading files...';

            // Load files for first folder
            try {
                const fileResult = await (browser_ext.runtime.sendMessage as (msg: any) => Promise<any>)({
                    type: "GET_FILES",
                    category: selectedFolder!.category,
                    folder: selectedFolder!.folder,
                });

                const files = filterFiles(fileResult.files || []);
                
                fileSelect.innerHTML = '';
                const fileDefaultOpt = document.createElement('option');
                fileDefaultOpt.value = '';
                fileDefaultOpt.textContent = files.length > 0 ? `Select file (${files.length} found)` : 'No files found';
                fileSelect.appendChild(fileDefaultOpt);

                files.forEach((file: { name: string; url: string; extension: string }) => {
                    const opt = document.createElement('option');
                    opt.value = JSON.stringify(file);
                    opt.textContent = file.name;
                    fileSelect.appendChild(opt);
                });

                fileSelect.style.display = 'block';
                
                if (fileNameEl) fileNameEl.textContent = files.length > 0 ? 'Select a subtitle file' : 'No subtitle files found';

            } catch (fileErr) {
                console.error('Get files error:', fileErr);
                if (fileNameEl) fileNameEl.textContent = 'Error loading files';
            }

        } catch (err) {
            console.error('Search error:', err);
            if (fileNameEl) fileNameEl.textContent = 'Search error';
        }
    });

    folderSelect.addEventListener('change', async () => {
        const value = folderSelect.value;
        if (!value) return;

        selectedFolder = JSON.parse(value);
        if (fileNameEl) fileNameEl.textContent = 'Loading files...';

        try {
            const result = await (browser_ext.runtime.sendMessage as (msg: any) => Promise<any>)({
                type: "GET_FILES",
                category: selectedFolder!.category,
                folder: selectedFolder!.folder,
            });

            const files = filterFiles(result.files || []);
            
            fileSelect.innerHTML = '';
            const defaultOpt = document.createElement('option');
            defaultOpt.value = '';
            defaultOpt.textContent = files.length > 0 ? `Select file (${files.length} found)` : 'No files found';
            fileSelect.appendChild(defaultOpt);

            files.forEach((file: { name: string; url: string; extension: string }) => {
                const opt = document.createElement('option');
                opt.value = JSON.stringify(file);
                opt.textContent = file.name;
                fileSelect.appendChild(opt);
            });

            fileSelect.style.display = 'block';
            
            if (fileNameEl) fileNameEl.textContent = files.length > 0 ? 'Select a subtitle file' : 'No subtitle files found';

        } catch (err) {
            console.error('Get files error:', err);
            if (fileNameEl) fileNameEl.textContent = 'Error loading files';
        }
    });

    fileSelect.addEventListener('change', async () => {
        const value = fileSelect.value;
        if (!value) {
            selectedFile = null;
            return;
        }

        selectedFile = JSON.parse(value);

        if (!selectedFile || !selectedFolder) {
            alert('Please select a folder first');
            return;
        }

        if (fileNameEl) fileNameEl.textContent = 'Loading subtitles...';

        try {
            const result = await (browser_ext.runtime.sendMessage as (msg: any) => Promise<any>)({
                type: "GET_SUBS_BY_URL",
                url: selectedFile.url,
                fileName: selectedFile.name,
            });

            const searchquery = {
                animeTitle: titleInput.value.trim(),
                season: seasonInput.value.trim(),
                episodeNumber: episodeInput.value.trim(),
                episodeTitle: epTitleInput.value.trim(),
                category: categorySelect.value || undefined,
                subtitleText: result.text,
                subtitleFileName: result.fileName,
                subtitleExtension: result.extension,
            };

            if (searchCallback) searchCallback(searchquery);

        } catch (err) {
            console.error('Load subtitles error:', err);
            if (fileNameEl) fileNameEl.textContent = 'Error loading subtitles';
        }
    });

    return form;
}

function createFileNameEl(): HTMLDivElement {
    const el = document.createElement('div');
    el.classList.add('fileName');
    el.textContent = 'Please click Search to find subtitles';
    Object.assign(el.style, {
        fontWeight: 'bold',
        marginBottom: '10px',
        fontSize: '12px',
        color: '#ffd700',
        textAlign: 'center',
        background: 'rgba(0,0,0,0.5)',
        borderRadius: '4px'
    });
    fileNameEl = el;
    return el;
}

function createToggle(state: any, toggleCallback: Function): HTMLElement {
    const label = document.createElement('label');
    Object.assign(label.style, { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' });

    const text = document.createElement('span');
    text.textContent = 'Subtitles';

    const switchEl = document.createElement('div');
    Object.assign(switchEl.style, {
        position: 'relative', width: '40px', height: '20px', background: '#ccc',
        borderRadius: '10px', cursor: 'pointer', transition: 'background 0.3s'
    });

    const knob = document.createElement('div');
    Object.assign(knob.style, {
        position: 'absolute', top: '2px', left: '2px',
        width: '16px', height: '16px', background: 'white',
        borderRadius: '50%', transition: 'left 0.3s'
    });

    switchEl.appendChild(knob);
    label.append(text, switchEl);

    function updateVisual() {
        knob.style.left = state.toggleState ? '22px' : '2px';
        switchEl.style.background = state.toggleState ? '#4caf50' : '#ccc';
    }

    updateVisual();

    switchEl.addEventListener('click', () => {
        state.toggleState = !state.toggleState;
        updateVisual();
        toggleCallback(state.toggleState, state.subtitleOffset, state.subtitleColor, state.subtitleFontSize);
    });

    return label;
}

function setupButtonToggle(button: HTMLDivElement, dropdown: HTMLDivElement) {
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = dropdown.style.display === 'none';
        dropdown.style.display = isHidden ? 'block' : 'none';
        button.style.backgroundImage = isHidden
            ? `url(${browser_ext.runtime.getURL('/assets/icons/cc-icon-black.png')})`
            : `url(${browser_ext.runtime.getURL('/assets/icons/cc-icon-white.png')})`;
    });

    // Close dropdown if user clicks outside
    document.addEventListener('click', () => {
        dropdown.style.display = 'none';
        button.style.backgroundImage = `url(${browser_ext.runtime.getURL('/assets/icons/cc-icon-white.png')})`;
    });
}

function createOffsetControls(state: any, toggleCallback: Function): HTMLDivElement {
    const container = document.createElement('div');

    // Offset display & reset
    const offsetRow = document.createElement('div');
    Object.assign(offsetRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' });

    const offsetDisplay = document.createElement('div');
    offsetDisplay.textContent = `Offset: ${state.subtitleOffset}ms`;
    offsetDisplay.style.fontWeight = 'bold';

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';
    Object.assign(resetBtn.style, {
        flex: '1 0 25%', padding: '4px 0', background: '#333', color: 'white', border: 'none', borderRadius: '4px',
        cursor: 'pointer', fontSize: '12px'
    });
    resetBtn.addEventListener('click', () => {
        state.subtitleOffset = 0;
        offsetDisplay.textContent = `Offset: ${state.subtitleOffset}ms`;
        toggleCallback(state.toggleState, state.subtitleOffset, state.subtitleColor, state.subtitleFontSize);
    });

    offsetRow.append(offsetDisplay, resetBtn);

    // Hint tooltip
    const hintBtn = document.createElement('div');
    hintBtn.textContent = '?';
    Object.assign(hintBtn.style, {
        display: 'inline-block', cursor: 'default', border: '1px solid #555', borderRadius: '50%',
        width: '18px', height: '18px', textAlign: 'center', lineHeight: '16px', fontSize: '12px', position: 'relative',
        userSelect: 'none'
    });

    const tooltip = document.createElement('div');
    tooltip.textContent = 'If subtitles appear before audio is played, decrease the offset.';
    Object.assign(tooltip.style, {
        position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
        background: '#222', color: 'white', padding: '4px 8px', borderRadius: '4px',
        whiteSpace: 'nowrap', fontSize: '12px', display: 'none', zIndex: '100'
    });

    hintBtn.appendChild(tooltip);
    hintBtn.addEventListener('mouseenter', () => tooltip.style.display = 'block');
    hintBtn.addEventListener('mouseleave', () => tooltip.style.display = 'none');

    offsetRow.appendChild(hintBtn);
    container.appendChild(offsetRow);

    // Offset buttons
    const offsets = [-1, 1, -10, 10, -100, 100, -1000, 1000];
    const btnContainer = document.createElement('div');
    Object.assign(btnContainer.style, { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px', marginBottom: '10px' });

    offsets.forEach(val => {
        const btn = document.createElement('button');
        btn.textContent = (val > 0 ? '+' : '') + val;
        Object.assign(btn.style, { flex: '1 0 25%', padding: '4px 0', background: '#333', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' });
        btn.addEventListener('click', () => {
            state.subtitleOffset += val;
            offsetDisplay.textContent = `Offset: ${state.subtitleOffset}ms`;
            toggleCallback(state.toggleState, state.subtitleOffset, state.subtitleColor, state.subtitleFontSize);
        });
        btnContainer.appendChild(btn);
    });

    container.appendChild(btnContainer);

    return container;
}

function createColorPicker(state: any, toggleCallback: Function): HTMLInputElement {
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = state.subtitleColor;
    Object.assign(colorInput.style, { width: '100%', height: '28px', border: 'none', padding: '0', cursor: 'pointer', marginBottom: '6px' });

    colorInput.addEventListener('input', () => {
        state.subtitleColor = colorInput.value;
        toggleCallback(state.toggleState, state.subtitleOffset, state.subtitleColor, state.subtitleFontSize);
    });

    return colorInput;
}

function createFontSizeControls(state: any, toggleCallback: Function): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' });

    const display = document.createElement('div');
    display.textContent = `Font Size: ${state.subtitleFontSize}px`;
    display.style.fontWeight = 'bold';

    const minusBtn = document.createElement('button'); minusBtn.textContent = '-1';
    const plusBtn = document.createElement('button'); plusBtn.textContent = '+1';

    [minusBtn, plusBtn].forEach(btn => {
        Object.assign(btn.style, { flex: '1 0 25%', padding: '4px 0', background: '#333', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' });
        row.appendChild(btn);
    });

    minusBtn.addEventListener('click', () => {
        state.subtitleFontSize -= 1;
        display.textContent = `Font Size: ${state.subtitleFontSize}px`;
        toggleCallback(state.toggleState, state.subtitleOffset, state.subtitleColor, state.subtitleFontSize);
    });
    plusBtn.addEventListener('click', () => {
        state.subtitleFontSize += 1;
        display.textContent = `Font Size: ${state.subtitleFontSize}px`;
        toggleCallback(state.toggleState, state.subtitleOffset, state.subtitleColor, state.subtitleFontSize);
    });

    row.insertBefore(display, row.firstChild);

    return row;
}
