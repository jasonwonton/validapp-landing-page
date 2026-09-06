export function reconcileKeyedElements(container, entries, {
    keyOf = (entry) => entry.key,
    markupOf = (entry) => entry.html,
} = {}) {
    const existing = new Map([...container.children]
        .filter((element) => element.dataset.listKey)
        .map((element) => [element.dataset.listKey, element]));
    const fragment = document.createDocumentFragment();

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
        fragment.append(element);
    }

    container.replaceChildren(fragment);
}
