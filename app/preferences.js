// Run before styles paint. These two bounded device preferences contain no account data.
(() => {
    const themeKey = 'valid:appearance', hapticsKey = 'valid:haptics';
    const system = matchMedia('(prefers-color-scheme: dark)');
    const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
    const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Session-only when storage is unavailable. */ } };
    let theme = ['light', 'dark'].includes(read(themeKey)) ? read(themeKey) : 'system';
    let haptics = read(hapticsKey) !== 'off', lastPulse = -Infinity;
    const supported = () => /Android/i.test(navigator.userAgent) && typeof navigator.vibrate === 'function';
    function applyTheme() {
        const resolved = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme;
        document.documentElement.dataset.theme = resolved;
        document.documentElement.dataset.appearance = theme;
        document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
            meta.removeAttribute('media');
            meta.content = resolved === 'dark' ? '#0b2528' : '#ccf7f4';
        });
        const select = document.getElementById('appearanceSelect');
        if (select) select.value = theme;
    }
    function haptic(pattern = 8) {
        if (!haptics || !supported() || document.hidden || navigator.userActivation?.hasBeenActive === false) return false;
        const now = performance.now();
        if (now - lastPulse < 80) return false;
        lastPulse = now;
        const bounded = (Array.isArray(pattern) ? pattern.slice(0, 3) : [pattern]).map(value => Math.min(40, Math.max(0, Number(value) || 0)));
        try { return navigator.vibrate(bounded); } catch { return false; }
    }
    function renderHaptics() {
        const toggle = document.getElementById('hapticsToggle');
        toggle.disabled = !supported();
        toggle.setAttribute('aria-checked', String(supported() && haptics));
        document.getElementById('hapticsHint').textContent = supported()
            ? 'Short tap feedback on this device. Phone settings may suppress vibration.'
            : 'Vibration is unavailable in this browser. Visual feedback stays enabled.';
        document.getElementById('testHaptics').disabled = !supported() || !haptics;
    }
    applyTheme();
    system.addEventListener('change', applyTheme);
    window.addEventListener('storage', event => {
        if (event.key === themeKey || event.key === null) { theme = ['light', 'dark'].includes(read(themeKey)) ? read(themeKey) : 'system'; applyTheme(); }
        if (event.key === hapticsKey || event.key === null) { haptics = read(hapticsKey) !== 'off'; if (document.getElementById('hapticsToggle')) renderHaptics(); }
    });
    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(); renderHaptics();
        document.getElementById('appearanceSelect').addEventListener('change', event => {
            theme = ['light', 'dark'].includes(event.target.value) ? event.target.value : 'system'; save(themeKey, theme); applyTheme();
        });
        document.getElementById('hapticsToggle').addEventListener('click', () => {
            haptics = !haptics; save(hapticsKey, haptics ? 'on' : 'off'); renderHaptics();
            if (!haptics) { try { navigator.vibrate?.(0); } catch {} }
        });
        document.getElementById('testHaptics').addEventListener('click', () => {
            const accepted = haptic([20, 30, 20]);
            document.getElementById('hapticsStatus').textContent = accepted
                ? 'Vibration requested. If you felt nothing, check your phone’s vibration settings.'
                : 'This browser did not accept the vibration request.';
        });
        document.addEventListener('click', event => {
            const button = event.target.closest?.('button');
            if (event.isTrusted && button && !button.disabled && !['testHaptics', 'hapticsToggle'].includes(button.id)) haptic();
        });
    }, { once: true });
    window.ValidPreferences = Object.freeze({ haptic });
})();
