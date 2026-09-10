// Pixel anchoring is independent of the bounded message window. Never center a
// message just because history arrived or a receipt changed its markup.
export function createTimelineScroll(timeline, { onEdge, onPosition } = {}) {
    let frame = 0;
    let lastTop = 0;
    let snapshot = null;
    let following = true;
    let suppressedTop = null;
    const rows = () => [...timeline.querySelectorAll(':scope > [data-list-key]')];
    const atBottom = () => timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop < 48;
    function capture() {
        const top = timeline.getBoundingClientRect().top;
        const anchors = rows().filter(row => !row.dataset.listKey.startsWith('window:') && row.getBoundingClientRect().bottom > top)
            .slice(0, 3).map(row => ({ key: row.dataset.listKey, offset: row.getBoundingClientRect().top - top }));
        return { anchors, top: timeline.scrollTop, bottom: following && atBottom() };
    }
    function remember() { snapshot = capture(); lastTop = timeline.scrollTop; }
    function restore(saved, { bottom = false } = {}) {
        if (bottom) timeline.scrollTop = timeline.scrollHeight;
        else if (saved) {
            const anchor = saved.anchors.find(item => rows().some(row => row.dataset.listKey === item.key));
            const row = anchor && rows().find(row => row.dataset.listKey === anchor.key);
            timeline.scrollTop = row ? timeline.scrollTop + row.getBoundingClientRect().top - timeline.getBoundingClientRect().top - anchor.offset : saved.top;
        }
        suppressedTop = timeline.scrollTop;
        following = bottom;
        remember();
        onPosition?.();
    }
    function handleScroll() {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            const top = timeline.scrollTop;
            const direction = top < lastTop ? 'older' : top > lastTop ? 'newer' : null;
            const programmed = suppressedTop !== null && Math.abs(top - suppressedTop) < 1;
            suppressedTop = null;
            following = atBottom();
            remember();
            onPosition?.();
            if (!programmed && direction && timeline.clientHeight &&
                (direction === 'older' ? top < 220 : timeline.scrollHeight - timeline.clientHeight - top < 220)) onEdge?.(direction);
        });
    }
    timeline.addEventListener('scroll', handleScroll, { passive: true });
    // A single observer, bounded to rendered rows, also covers decoded media,
    // expanded reactions, font loading and keyboard/viewport resizing.
    const observer = new ResizeObserver(() => {
        if (!timeline.clientHeight || !snapshot) return;
        restore(snapshot, { bottom: following });
    });
    function observe() {
        observer.disconnect();
        observer.observe(timeline);
        for (const row of rows()) observer.observe(row);
        remember();
    }
    return {
        capture, restore, observe, atBottom,
        reset() { observer.disconnect(); cancelAnimationFrame(frame); frame = 0; following = true; snapshot = null; suppressedTop = null; lastTop = timeline.scrollTop; },
        disconnect() { observer.disconnect(); cancelAnimationFrame(frame); timeline.removeEventListener('scroll', handleScroll); },
    };
}
