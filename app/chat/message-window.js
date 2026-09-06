export const MAX_RENDERED_MESSAGES = 120;
export const MESSAGE_WINDOW_OVERLAP = 30;

function boundedInteger(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

export function createMessageWindow({
    maxRendered = MAX_RENDERED_MESSAGES,
    overlap = MESSAGE_WINDOW_OVERLAP,
} = {}) {
    const size = boundedInteger(maxRendered, MAX_RENDERED_MESSAGES, 20, 250);
    const retained = boundedInteger(overlap, MESSAGE_WINDOW_OVERLAP, 1, size - 1);
    const step = size - retained;
    let activeChatId = null;
    let start = 0;
    let end = 0;
    let total = 0;
    let pinnedToEnd = true;
    let anchorKey = null;

    function itemKey(item) {
        return String(item?.id ?? "");
    }

    function setBottom(nextTotal) {
        total = nextTotal;
        end = total;
        start = Math.max(0, end - size);
        pinnedToEnd = true;
    }

    function clampRange(nextTotal) {
        total = nextTotal;
        if (total <= size) {
            start = 0;
            end = total;
            pinnedToEnd = true;
            return;
        }
        start = Math.max(0, Math.min(start, total - 1));
        end = Math.max(start + 1, Math.min(total, Math.max(end, start + size)));
        if (end - start > size) start = end - size;
        if (pinnedToEnd) setBottom(total);
    }

    function snapshot(items) {
        anchorKey = start < end ? itemKey(items[start]) : null;
        return Object.freeze({
            start,
            end,
            total,
            hiddenBefore: start,
            hiddenAfter: Math.max(0, total - end),
            items: items.slice(start, end),
            maxRendered: size,
        });
    }

    function reset(chatId, items) {
        activeChatId = String(chatId ?? "");
        setBottom(items.length);
        return snapshot(items);
    }

    function focus(items, messageId, alignment = "center") {
        const index = items.findIndex((item) => itemKey(item) === String(messageId));
        if (index < 0) return false;
        if (alignment === "start") start = Math.max(0, Math.min(index, items.length - size));
        else if (alignment === "end") start = Math.max(0, index - size + 1);
        else start = Math.max(0, Math.min(index - Math.floor(size / 2), items.length - size));
        end = Math.min(items.length, start + size);
        pinnedToEnd = end === items.length;
        return true;
    }

    function range(chatId, items, { toEnd = false, focusId = null, focusAlignment = "center" } = {}) {
        const key = String(chatId ?? "");
        if (key !== activeChatId) return reset(key, items);

        const nextTotal = items.length;
        if (toEnd) setBottom(nextTotal);
        else if (focusId && focus(items, focusId, focusAlignment)) total = nextTotal;
        else if (nextTotal !== total) {
            if (pinnedToEnd) setBottom(nextTotal);
            else {
                const anchoredIndex = anchorKey ? items.findIndex((item) => itemKey(item) === anchorKey) : -1;
                if (anchoredIndex >= 0) {
                    start = anchoredIndex;
                    end = Math.min(nextTotal, start + size);
                }
                clampRange(nextTotal);
            }
        } else clampRange(nextTotal);
        return snapshot(items);
    }

    function previous(chatId, items) {
        range(chatId, items);
        if (start <= 0) return snapshot(items);
        start = Math.max(0, start - step);
        end = Math.min(items.length, start + size);
        pinnedToEnd = false;
        return snapshot(items);
    }

    function next(chatId, items) {
        range(chatId, items);
        if (end >= items.length) return snapshot(items);
        end = Math.min(items.length, end + step);
        start = Math.max(0, end - size);
        pinnedToEnd = end === items.length;
        return snapshot(items);
    }

    return { range, previous, next };
}
