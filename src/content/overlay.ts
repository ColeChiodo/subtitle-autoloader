const browser_ext = typeof browser !== "undefined" ? browser : chrome;

let fileNameEl: HTMLDivElement | null = null;

/**
 * Create subtitle overlay
 */
export function initSubtitles(defaults: { subs: boolean; }) {
    if (document.querySelector('.kuraji-subtitles')) return null;

    const overlay = createOverlay();
    const span = createSubtitleSpan();

    overlay.appendChild(span);
    document.body.appendChild(overlay);
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
    const span = document.createElement('span');
    Object.assign(span.style, {
        position: 'absolute',
        background: 'rgba(0,0,0,0.5)',
        padding: '2px 6px',
        color: 'white',
        fontSize: '25px',
        textShadow: '2px 2px 4px black',
        cursor: 'move',
        pointerEvents: 'all',
        userSelect: 'none',
        display: 'none' // hide initially
    });

    const observer = new MutationObserver(() => {
        span.style.display = span.textContent && span.textContent.trim() !== '' ? 'inline-block' : 'none';
    });

    observer.observe(span, { characterData: true, childList: true, subtree: true });

    makeDraggable(span);

    return span;
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
    searchCallback: (searchquery: { animeTitle: string; season?: string; episodeNumber?: string; episodeTitle?: string; }) => void
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
    }) => void
): HTMLFormElement {
    const form = document.createElement('form');
    Object.assign(form.style, { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' });

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

    const titleInput = makeInput(defaults.search.title || '', 'Anime title *', 'animeTitle', true);
    const seasonInput = makeInput(defaults.search.season?.toString() || '', 'Season (optional)', 'season');
    const episodeInput = makeInput(defaults.search.episode?.toString() || '', 'Episode number (optional)', 'episodeNumber');
    const epTitleInput = makeInput(defaults.search.episodeTitle || '', 'Episode title (optional)', 'episodeTitle');

    const searchBtn = document.createElement('button');
    searchBtn.type = 'submit';
    searchBtn.textContent = 'Search';
    Object.assign(searchBtn.style, {
        background: '#4caf50', color: 'white', border: 'none', borderRadius: '4px',
        padding: '6px 0', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', marginTop: '2px'
    });

    form.append(titleInput, seasonInput, episodeInput, epTitleInput, searchBtn);

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const animeTitle = titleInput.value.trim();
        if (fileNameEl) fileNameEl.textContent = 'Searching...';
        if (!animeTitle) { alert('Anime title is required.'); return; }
        const searchquery = {
            animeTitle,
            season: seasonInput.value.trim(),
            episodeNumber: episodeInput.value.trim(),
            episodeTitle: epTitleInput.value.trim()
        };
        console.log('Search Query:', searchquery);
        if (searchCallback) searchCallback(searchquery);
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
