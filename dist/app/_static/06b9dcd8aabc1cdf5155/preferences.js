// Run before styles paint. These two bounded device preferences contain no account data.
(() => {
    const themeKey = 'valid:appearance', hapticsKey = 'valid:haptics';
    const system = matchMedia('(prefers-color-scheme: dark)');
    const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
    const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Session-only when storage is unavailable. */ } };
    let theme = ['light', 'dark'].includes(read(themeKey)) ? read(themeKey) : 'system';
    let haptics = read(hapticsKey) !== 'off', lastPulse = -Infinity, iosSwitch = null;
    // Android Chrome: navigator.vibrate. iPhone Safari (17.4+) has no vibrate,
    // but toggling a native <input type="checkbox" switch> during a user gesture
    // plays the system selection haptic, so a hidden switch stands in for it.
    const vibrates = () => /Android/i.test(navigator.userAgent) && typeof navigator.vibrate === 'function';
    const appleTouch = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const switchHaptics = () => !vibrates() && appleTouch() && typeof HTMLInputElement !== 'undefined' && 'switch' in HTMLInputElement.prototype;
    const supported = () => vibrates() || switchHaptics();
    // Android patterns stay short (perceptible, never buzzy); iOS toggles are 1–2 system ticks.
    const KINDS = {
        selection: { pattern: 12, toggles: [0] },
        light: { pattern: 15, toggles: [0] },
        medium: { pattern: 22, toggles: [0] },
        heavy: { pattern: 30, toggles: [0, 45] },
        success: { pattern: [16, 60, 24], toggles: [0, 90] },
        warning: { pattern: [24, 80, 24], toggles: [0, 120] },
        error: { pattern: [30, 50, 30], toggles: [0, 60] },
    };
    function toggleSwitch() {
        if (!iosSwitch?.isConnected) {
            iosSwitch = document.createElement('label');
            iosSwitch.hidden = true;
            iosSwitch.setAttribute('aria-hidden', 'true');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.tabIndex = -1;
            input.setAttribute('switch', '');
            iosSwitch.append(input);
            // The simulated clicks must never reach app listeners (outside-click menus, the tap haptic below).
            for (const type of ['click', 'input', 'change']) iosSwitch.addEventListener(type, event => event.stopPropagation());
            (document.head || document.documentElement).append(iosSwitch);
        }
        iosSwitch.click();
    }
    function haptic(kind = 'light') {
        if (!haptics || !supported() || document.hidden || navigator.userActivation?.hasBeenActive === false) return false;
        const now = performance.now();
        if (now - lastPulse < 80) return false;
        lastPulse = now;
        const preset = typeof kind === 'string' ? (KINDS[kind] || KINDS.light) : { pattern: kind, toggles: [0] };
        if (!vibrates()) {
            try {
                for (const delay of preset.toggles) delay ? setTimeout(toggleSwitch, delay) : toggleSwitch();
                return true;
            } catch { return false; }
        }
        const bounded = (Array.isArray(preset.pattern) ? preset.pattern.slice(0, 3) : [preset.pattern]).map(value => Math.min(40, Math.max(0, Number(value) || 0)));
        try { return navigator.vibrate(bounded); } catch { return false; }
    }
    function applyTheme() {
        const resolved = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme;
        document.documentElement.dataset.theme = resolved;
        document.documentElement.dataset.appearance = theme;
        document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
            meta.removeAttribute('media');
            meta.content = resolved === 'dark' ? '#07181a' : '#ccf7f4';
        });
        document.querySelectorAll('button[data-appearance]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.appearance === theme)));
        const hint = document.getElementById('appearanceHint');
        if (hint) hint.textContent = theme === 'system' ? 'Matches your device and changes automatically.' : 'This choice stays on until you change it.';
    }
    function renderHaptics() {
        for (const id of ['hapticsToggle', 'testHaptics', 'hapticsStatus']) document.getElementById(id).hidden = !supported();
        const toggle = document.getElementById('hapticsToggle');
        toggle.disabled = !supported();
        toggle.setAttribute('aria-checked', String(supported() && haptics));
        document.getElementById('hapticsHint').textContent = switchHaptics()
            ? 'Light taps on this iPhone. System Haptics in iPhone Settings must be on.'
            : supported()
            ? 'Short tap feedback on this device. Phone settings may suppress vibration.'
            : 'Vibration is unavailable in this browser. Visual feedback stays enabled.';
        const test = document.getElementById('testHaptics');
        test.textContent = switchHaptics() ? 'Test haptics' : 'Test vibration';
        test.disabled = !supported() || !haptics;
    }
    applyTheme();
    system.addEventListener('change', applyTheme);
    window.addEventListener('storage', event => {
        if (event.key === themeKey || event.key === null) { theme = ['light', 'dark'].includes(read(themeKey)) ? read(themeKey) : 'system'; applyTheme(); }
        if (event.key === hapticsKey || event.key === null) { haptics = read(hapticsKey) !== 'off'; if (document.getElementById('hapticsToggle')) renderHaptics(); }
    });
    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(); renderHaptics();
        document.querySelectorAll('button[data-appearance]').forEach(button => button.addEventListener('click', () => {
            theme = button.dataset.appearance; save(themeKey, theme); applyTheme();
        }));
        document.getElementById('hapticsToggle').addEventListener('click', () => {
            haptics = !haptics; save(hapticsKey, haptics ? 'on' : 'off'); renderHaptics();
            if (!haptics) { try { navigator.vibrate?.(0); } catch {} }
        });
        document.getElementById('testHaptics').addEventListener('click', () => {
            lastPulse = -Infinity;
            const accepted = haptic('success');
            document.getElementById('hapticsStatus').textContent = accepted && switchHaptics()
                ? 'Haptic played. If you felt nothing, turn on System Haptics in iPhone Settings › Sounds & Haptics.'
                : accepted
                ? 'Vibration requested. If you felt nothing, check your phone’s vibration settings.'
                : 'This browser did not accept the vibration request.';
        });
        document.addEventListener('click', event => {
            const button = event.target.closest?.('button');
            // One light tick per real tap. Handlers that call a stronger kind run first
            // (target before document), so the throttle drops this duplicate.
            if (event.isTrusted && button && !button.disabled && !['testHaptics', 'hapticsToggle'].includes(button.id)) haptic('light');
        });
    }, { once: true });
    window.ValidPreferences = Object.freeze({ haptic, hapticsSupported: supported, HAPTIC_KINDS: Object.freeze(Object.keys(KINDS)) });
})();
