// `preserveMedia` (a selector for elements carrying a stable data-media-key)
// moves already-loaded images from a replaced element into its replacement, so
// a re-render (new neighbours, a re-signed URL) never downloads them again.
export function reconcileKeyedElements(container, entries, {
    keyOf = (entry) => entry.key,
    markupOf = (entry) => entry.html,
    preserveMedia = null,
} = {}) {
    const existing = new Map([...container.children]
        .filter((element) => element.dataset.listKey)
        .map((element) => [element.dataset.listKey, element]));
    let cursor = container.firstElementChild;
    const retained = new Set();

    for (const entry of entries) {
        const key = String(keyOf(entry));
        const markup = markupOf(entry);
        let element = existing.get(key);
        if (!element || element.__validListMarkup !== markup) {
            const previous = element;
            const template = document.createElement("template");
            template.innerHTML = String(markup).trim();
            element = template.content.firstElementChild;
            if (!element) throw new Error(`List entry ${key} did not render an element.`);
            element.dataset.listKey = key;
            element.__validListMarkup = markup;
            if (previous && preserveMedia) carryLoadedMedia(previous, element, preserveMedia);
        }
        retained.add(element);
        // Leave unchanged live nodes attached (focus, audio and scroll anchors).
        if (element !== cursor) container.insertBefore(element, cursor);
        cursor = element.nextElementSibling;
    }

    for (const element of [...container.children]) if (!retained.has(element)) element.remove();
}

function carryLoadedMedia(previous, next, selector) {
    const loaded = new Map();
    for (const image of previous.querySelectorAll(selector)) {
        // Only a real, successfully decoded image is worth keeping: a failed one
        // (fallback placeholder) must take the replacement's fresh URL instead.
        const real = image.complete && image.naturalWidth > 1 && image.dataset.mediaKey
            && !image.classList.contains("media-placeholder") && !String(image.currentSrc || image.src).startsWith("data:");
        if (real) loaded.set(image.dataset.mediaKey, image);
    }
    if (!loaded.size) return;
    for (const image of next.querySelectorAll(selector)) {
        const old = loaded.get(image.dataset.mediaKey);
        if (!old) continue;
        // Keep the new element's presentation attributes; keep the old bitmap.
        old.className = image.className;
        old.alt = image.alt;
        image.replaceWith(old);
        loaded.delete(image.dataset.mediaKey);
    }
}
