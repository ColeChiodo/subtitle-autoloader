/**
 * Turn a file name in url format into a human-readable string
 * @param rawName 
 * @returns 
 */
function sanitizeFileName(rawName: string): string {
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
 * Initializes the overlay and subtitle span
 */
export function initSubtitles() {
    const overlay = document.createElement('div');
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

    const span = document.createElement('span');
    Object.assign(span.style, {
        position: 'absolute',
        background: 'rgba(0,0,0,0.5)',
        padding: '2px 6px',
        color: 'white',
        fontSize: '25px',
        textShadow: '2px 2px 4px black',
        cursor: 'move',
        pointerEvents: 'auto',
        userSelect: 'none'
    });

    overlay.appendChild(span);
    document.body.appendChild(overlay);
    overlay.style.display = 'none';

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

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
        const x = e.clientX - offsetX;
        const y = e.clientY - offsetY;
        span.style.left = `${x}px`;
        span.style.top = `${y}px`;
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        document.body.style.userSelect = '';
    });

    return overlay;
}

/**
 * Creates the menu with toggle, offset buttons, and color options
 */
export function createMenu(
    parent: HTMLElement,
    defaults: { subs: boolean; offset: number; color: string; fontSize: number; fileName: string | null },
    toggleCallback: (subs: boolean, offset: number, color: string, fontSize: number) => void
) {
    const existing = document.querySelector('.kuraji-menu-button');
    if (existing) return;

    let subtitleColor = defaults.color;
    let subtitleOffset = defaults.offset;
    let subtitleFontSize = defaults.fontSize;

    const button = document.createElement('div');
    button.classList.add('kuraji-menu-button');
    Object.assign(button.style, {
        width: '40px',
        height: '40px',
        cursor: 'pointer',
        zIndex: '10000000',
        backgroundImage: `url(${browser.runtime.getURL('assets/icons/cc-icon.png')})`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        userSelect: 'none',
        display: 'inline-block',
        borderRadius: '50%',
        position: 'relative'
    });

    // Dropdown container
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
        minWidth: '220px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px'
    });
    dropdown.addEventListener('click', (e) => e.stopPropagation());

    // Display subtitle file name at top
    if (defaults.fileName) {
        const fileNameEl = document.createElement('div');
        fileNameEl.textContent = `${sanitizeFileName(defaults.fileName || 'Kuraji Subtitles')}`;
        Object.assign(fileNameEl.style, {
            fontWeight: 'bold',
            marginBottom: '10px',
            fontSize: '12px',
            color: '#ffd700',
            textAlign: 'center',
			background: 'rgba(0,0,0,0.5)',
			borderRadius: '4px',
        });
        dropdown.appendChild(fileNameEl);
    }

    // Subtitles toggle (sliding switch)
    const toggleLabel = document.createElement('label');
    Object.assign(toggleLabel.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '10px'
    });
    toggleLabel.innerHTML = `
        <span>Subtitles</span>
        <div style="
            position: relative;
            width: 40px;
            height: 20px;
            background: #ccc;
            border-radius: 10px;
            cursor: pointer;
            transition: background 0.3s;
        ">
            <div style="
                position: absolute;
                top: 2px;
                left: 2px;
                width: 16px;
                height: 16px;
                background: white;
                border-radius: 50%;
                transition: left 0.3s;
            "></div>
        </div>
    `;
    const toggleSwitch = toggleLabel.querySelector('div')!;
    const toggleKnob = toggleSwitch.querySelector('div')!;
    let toggleState = defaults.subs;
    toggleSwitch.addEventListener('click', () => {
        toggleState = !toggleState;
        toggleKnob.style.left = toggleState ? '22px' : '2px';
        toggleSwitch.style.background = toggleState ? '#4caf50' : '#ccc';
        toggleCallback(toggleState, subtitleOffset, subtitleColor, subtitleFontSize);
    });
    dropdown.appendChild(toggleLabel);

	    // Container for offset display and hint button
	const offsetRow = document.createElement('div');
	Object.assign(offsetRow.style, {
		display: 'flex',
		justifyContent: 'space-between', // display on opposite sides
		alignItems: 'center',            // vertically center
		marginBottom: '8px'
	});

	// Offset display
	const offsetDisplay = document.createElement('div');
	offsetDisplay.textContent = `Offset: ${subtitleOffset}ms`;
	Object.assign(offsetDisplay.style, {
		fontWeight: 'bold'
	});
	offsetRow.appendChild(offsetDisplay);

	// Hint button
	const hintBtn = document.createElement('div');
	hintBtn.textContent = '?';
	Object.assign(hintBtn.style, {
		display: 'inline-block',
		cursor: 'default',
		border: '1px solid #555',
		borderRadius: '50%',
		width: '18px',
		height: '18px',
		textAlign: 'center',
		lineHeight: '16px',
		fontSize: '12px',
		position: 'relative',
		userSelect: 'none'
	});

	// Tooltip
	const tooltip = document.createElement('div');
	tooltip.textContent = 'If subtitles appear before audio is played, decrease the offset.';
	Object.assign(tooltip.style, {
		position: 'absolute',
		bottom: '24px',
		left: '50%',
		transform: 'translateX(-50%)',
		background: '#222',
		color: 'white',
		padding: '4px 8px',
		borderRadius: '4px',
		whiteSpace: 'nowrap',
		fontSize: '12px',
		display: 'none',
		zIndex: '100'
	});
	hintBtn.appendChild(tooltip);

	hintBtn.addEventListener('mouseenter', () => tooltip.style.display = 'block');
	hintBtn.addEventListener('mouseleave', () => tooltip.style.display = 'none');

	offsetRow.appendChild(hintBtn);

	// Add the row to the dropdown
	dropdown.appendChild(offsetRow);

    // Offset buttons
    const offsets = [ -1, +1, -10, +10, -100, +100, -1000, +1000];
    const btnContainer = document.createElement('div');
    Object.assign(btnContainer.style, {
		display: 'grid',
		gridTemplateColumns: 'repeat(2, 1fr)', // 2 columns
		gap: '4px',
		marginBottom: '10px'
	});

    offsets.forEach(val => {
        const btn = document.createElement('button');
        btn.textContent = (val > 0 ? '+' : '') + val;
        Object.assign(btn.style, {
            flex: '1 0 25%',
            padding: '4px 0',
            background: '#333',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px'
        });
        btn.addEventListener('click', () => {
            subtitleOffset += val;
            offsetDisplay.textContent = `Offset: ${subtitleOffset}ms`;
            toggleCallback(toggleState, subtitleOffset, subtitleColor, subtitleFontSize);
        });
        btnContainer.appendChild(btn);
    });
    dropdown.appendChild(btnContainer);

    // Color picker
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = subtitleColor;
    Object.assign(colorInput.style, {
        width: '100%',
        height: '28px',
        border: 'none',
        padding: '0',
        cursor: 'pointer',
        marginBottom: '6px'
    });
    colorInput.addEventListener('input', () => {
        subtitleColor = colorInput.value;
        toggleCallback(toggleState, subtitleOffset, subtitleColor, subtitleFontSize);
    });
    dropdown.appendChild(colorInput);

	//allow edit fontsize with -1 +1 buttons
	const fontSizeRow = document.createElement('div');
	Object.assign(fontSizeRow.style, {
		display: 'flex',
		justifyContent: 'space-between', // display on opposite sides
		alignItems: 'center',            // vertically center
		marginBottom: '8px'
	});

	const fontSizeDisplay = document.createElement('div');
	fontSizeDisplay.textContent = `Font Size: ${subtitleFontSize}px`;
	Object.assign(fontSizeDisplay.style, {
		fontWeight: 'bold'
	});
	fontSizeRow.appendChild(fontSizeDisplay);

	// Add the row to the dropdown
	dropdown.appendChild(fontSizeRow);

	const fontSizeButtons = [ -1, +1];
	fontSizeButtons.forEach(val => {
		const btn = document.createElement('button');
		btn.textContent = (val > 0 ? '+' : '') + val;
		Object.assign(btn.style, {
			flex: '1 0 25%',
			padding: '4px 0',
			background: '#333',
			color: 'white',
			border: 'none',
			borderRadius: '4px',
			cursor: 'pointer',
			fontSize: '12px'
		});
		btn.addEventListener('click', () => {
			subtitleFontSize += val;
			fontSizeDisplay.textContent = `Font Size: ${subtitleFontSize}px`;
			toggleCallback(toggleState, subtitleOffset, subtitleColor, subtitleFontSize);
		});
		fontSizeRow.appendChild(btn);
	});

    button.appendChild(dropdown);

    button.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });

    document.addEventListener('click', () => {
        dropdown.style.display = 'none';
    });

    const index = 3;
    const referenceNode = parent.children[index];
    parent.insertBefore(button, referenceNode);
}