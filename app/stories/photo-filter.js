// Swipe colour looks for a Story photo, like iOS ChatMediaCaptureView(purpose:
// .story): a horizontal swipe (or the arrow keys) cycles the review filters,
// flashes the look's name, and the chosen look is burned into the posted JPEG.
// Loaded on first Story photo, outside the app shell; without it the composer
// simply posts the original photo.
import { applyReviewFilter, cycleFilterIndex, loadReviewFilters, REVIEW_FILTERS } from "../camera/review-filters.js";
import { chatPhotoProfile, decodePhoto, encodeChatPhoto, renderPhoto } from "../camera/photo-pipeline.js";

const SWIPE_MIN = 44;
const DISPLAY_MAX = 1080;

export async function createStoryPhotoFilter({ preview, source, api, config, canSwipe = () => true, onChange = () => {} }) {
    const image = preview.querySelector("img");
    if (!image) return null;
    const decoded = await decodePhoto(source);
    let display;
    try { display = renderPhoto(decoded.image, { maxDimension: DISPLAY_MAX }); } finally { decoded.release(); }

    const canvas = document.createElement("canvas");
    canvas.className = "story-filter-canvas";
    canvas.hidden = true;
    canvas.setAttribute("aria-hidden", "true");
    const name = document.createElement("p");
    name.className = "story-filter-name";
    name.setAttribute("aria-hidden", "true");
    const status = document.createElement("p");
    status.className = "visually-hidden";
    status.setAttribute("aria-live", "polite");
    image.after(canvas, name, status);
    image.tabIndex = 0;
    image.draggable = false; // a native image drag would cancel the swipe
    image.setAttribute("aria-label", "Story photo preview. Swipe or use the left and right arrow keys to change the filter.");

    let filters = [...REVIEW_FILTERS];
    let index = 0;
    let start = null;
    const composed = new Map();
    void loadReviewFilters(api).then((list) => { if (index === 0) filters = list; });

    function regrade() {
        const filter = filters[index];
        canvas.hidden = !filter || filter.id === "none";
        if (canvas.hidden) return;
        canvas.width = display.width;
        canvas.height = display.height;
        canvas.getContext("2d").drawImage(display, 0, 0);
        applyReviewFilter(canvas, filter);
    }

    function cycle(step) {
        if (!canSwipe()) return;
        index = cycleFilterIndex(index, step, filters.length);
        try { window.ValidPreferences?.haptic?.("selection"); } catch (_) { /* optional */ }
        name.textContent = filters[index].name;
        name.classList.remove("show");
        void name.offsetWidth;
        name.classList.add("show");
        status.textContent = `${filters[index].name} filter`;
        regrade();
        onChange(filters[index]);
    }

    const onDown = (event) => {
        if (event.target.closest("[data-media-overlay-position]") || (event.pointerType === "mouse" && event.button !== 0)) return;
        start = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const onUp = (event) => {
        if (!start || event.pointerId !== start.id) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        start = null;
        if (event.type === "pointerup" && Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.35) cycle(dx < 0 ? 1 : -1);
    };
    const onKey = (event) => {
        if (event.target !== image) return;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            cycle(event.key === "ArrowRight" ? 1 : -1);
        }
    };
    preview.addEventListener("pointerdown", onDown);
    preview.addEventListener("pointerup", onUp);
    preview.addEventListener("pointercancel", onUp);
    preview.addEventListener("keydown", onKey);

    return {
        get filter() { return filters[index]; },
        cycle,
        // The photo to post: the prepared original, or the look burned in at the
        // same size and encode budget the original used.
        async compose(original) {
            const filter = filters[index];
            if (!filter || filter.id === "none") return original;
            if (composed.has(filter.id)) return composed.get(filter.id);
            const profile = chatPhotoProfile(config);
            const again = await decodePhoto(source);
            let full;
            try { full = renderPhoto(again.image, { maxDimension: profile.maxDimension }); } finally { again.release(); }
            try {
                applyReviewFilter(full, filter);
                const { file } = await encodeChatPhoto(full, profile, { preview: false });
                composed.set(filter.id, file);
                return file;
            } finally {
                full.width = full.height = 0;
            }
        },
        destroy() {
            preview.removeEventListener("pointerdown", onDown);
            preview.removeEventListener("pointerup", onUp);
            preview.removeEventListener("pointercancel", onUp);
            preview.removeEventListener("keydown", onKey);
            canvas.width = canvas.height = 0;
            display.width = display.height = 0;
            composed.clear();
        },
    };
}
