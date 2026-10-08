// The camera's lens carousel, after iOS ChatMediaCaptureView
// .cameraLensCarousel: 56 pt gradient circles 13 pt apart in 76 pt columns,
// a 66 pt white ring and full scale on the selection (0.94 otherwise), the
// selection kept centred, a light haptic on change, and a horizontal swipe
// on the preview stepping through lenses with wraparound.
import { setRuntimeStyles } from '../runtime-style.js';

const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const reducedMotion = () => matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function createLensCarousel({ container, lenses, onSelect, selected = 'original', swipeTarget = null, haptic = kind => window.ValidPreferences?.haptic?.(kind) }) {
    let items = [...lenses], current = selected, loadingId = null, busy = false, disabled = false;
    const root = document.createElement('div');
    root.className = 'lens-carousel';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Lenses');
    root.innerHTML = '<div class="lens-carousel-track"></div>';
    const track = root.firstElementChild;
    container.append(root);

    function render() {
        track.innerHTML = items.map(lens => {
            const icon = lens.icon
                ? `<img src="${escapeHTML(lens.icon)}" alt="" width="54" height="54" decoding="async" loading="lazy" draggable="false">`
                : '<span class="lens-original-mark" aria-hidden="true"></span>';
            return `<button type="button" class="lens-carousel-item" data-lens-id="${escapeHTML(lens.id)}" aria-label="${escapeHTML(lens.name)}" aria-pressed="false"><span class="lens-circle"><span class="lens-gradient"></span>${icon}<span class="lens-spinner" aria-hidden="true"></span></span><span class="lens-title">${escapeHTML(lens.name)}</span></button>`;
        }).join('');
        // Gradients come from data, and the CSP forbids inline style
        // attributes, so they go through the trusted runtime stylesheet.
        for (const button of track.children) {
            const lens = items.find(item => item.id === button.dataset.lensId);
            setRuntimeStyles(button.querySelector('.lens-gradient'), { background: `linear-gradient(135deg, ${lens.colors[0]}, ${lens.colors[1]})` });
        }
        sync(false);
    }

    function sync(animated = true) {
        for (const button of track.children) {
            const isSelected = button.dataset.lensId === current;
            button.classList.toggle('is-selected', isSelected);
            button.setAttribute('aria-pressed', String(isSelected));
            button.classList.toggle('is-loading', button.dataset.lensId === loadingId);
            button.disabled = disabled;
        }
        root.setAttribute('aria-busy', String(busy));
        root.classList.toggle('is-busy', busy);
        centre(animated);
    }

    function centre(animated) {
        const button = [...track.children].find(item => item.dataset.lensId === current);
        if (!button || !track.clientWidth) return;
        const left = button.offsetLeft + button.offsetWidth / 2 - track.clientWidth / 2;
        track.scrollTo({ left, behavior: animated && !reducedMotion() ? 'smooth' : 'auto' });
    }

    function select(id, { source = 'tap' } = {}) {
        if (disabled || !items.some(lens => lens.id === id)) return;
        const changed = id !== current;
        current = id;
        sync();
        if (changed) { haptic('light'); onSelect?.(id, { source }); }
    }

    function cycle(offset) {
        if (disabled || !items.length) return;
        const index = Math.max(0, items.findIndex(lens => lens.id === (loadingId ?? current)));
        select(items[(index + offset + items.length) % items.length].id, { source: 'swipe' });
    }

    track.addEventListener('click', event => {
        const button = event.target.closest('.lens-carousel-item');
        if (button) select(button.dataset.lensId);
    });

    // Swipe on the preview: at least 44 px sideways and clearly more sideways
    // than vertical, as on iOS (translation > 44, |x| > |y| * 1.35).
    let start = null;
    const down = event => {
        // Dragging the carousel itself scrolls it; it is not a lens swipe.
        if (!event.isPrimary || root.contains(event.target)) { start = null; return; }
        start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    };
    const up = event => {
        if (!start || event.pointerId !== start.id) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        start = null;
        if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.35) cycle(dx < 0 ? 1 : -1);
    };
    const cancel = () => { start = null; };
    if (swipeTarget) {
        swipeTarget.classList.add('lens-swipe-surface');
        swipeTarget.addEventListener('pointerdown', down);
        swipeTarget.addEventListener('pointerup', up);
        swipeTarget.addEventListener('pointercancel', cancel);
    }
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => centre(false)) : null;
    resize?.observe(track);

    render();
    return {
        element: root,
        get selected() { return current; },
        select, cycle,
        setLenses(next) { items = [...next]; if (!items.some(lens => lens.id === current)) current = items[0]?.id ?? 'original'; render(); },
        setSelected(id) { current = id; sync(); },
        /** `busy`: the model is still loading; `lensId`: the lens waiting on it. */
        setLoading(isBusy, lensId = null) { busy = Boolean(isBusy); loadingId = lensId; sync(false); },
        setDisabled(value) { disabled = Boolean(value); sync(false); },
        destroy() {
            resize?.disconnect();
            if (swipeTarget) {
                swipeTarget.classList.remove('lens-swipe-surface');
                swipeTarget.removeEventListener('pointerdown', down);
                swipeTarget.removeEventListener('pointerup', up);
                swipeTarget.removeEventListener('pointercancel', cancel);
            }
            root.remove();
        },
    };
}
