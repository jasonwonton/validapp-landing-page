export function reconcileKeyedElements(container, entries, {
    keyOf = (entry) => entry.key,
    markupOf = (entry) => entry.html,
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
            const template = document.createElement("template");
            template.innerHTML = String(markup).trim();
            element = template.content.firstElementChild;
            if (!element) throw new Error(`List entry ${key} did not render an element.`);
            element.dataset.listKey = key;
            element.__validListMarkup = markup;
        }
        retained.add(element);
        // Leave unchanged live nodes attached (focus, audio and scroll anchors).
        if (element !== cursor) container.insertBefore(element, cursor);
        cursor = element.nextElementSibling;
    }

    for (const element of [...container.children]) if (!retained.has(element)) element.remove();
}
