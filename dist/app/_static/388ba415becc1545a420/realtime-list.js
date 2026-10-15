const defaultSchedule = (callback) => {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
    return setTimeout(callback, 0);
};

const defaultCancel = (handle) => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
    else clearTimeout(handle);
};

export function createRealtimeList({
    keyOf,
    compare = null,
    schedule = defaultSchedule,
    cancel = defaultCancel,
} = {}) {
    if (typeof keyOf !== "function") throw new TypeError("createRealtimeList requires keyOf(item).");

    const items = new Map();
    const subscribers = new Set();
    const connectionSubscribers = new Set();
    let pending = [];
    let scheduled = null;
    let paused = false;
    let destroyed = false;
    let connection = { state: "idle", attempt: 0, error: null };

    const snapshot = () => {
        const values = [...items.values()];
        return compare ? values.sort(compare) : values;
    };

    const notify = (changes) => {
        const values = snapshot();
        for (const subscriber of subscribers) subscriber(values, changes);
        return values;
    };

    const run = () => {
        scheduled = null;
        if (paused || destroyed || !pending.length) return snapshot();
        const operations = pending;
        pending = [];
        const changes = [];
        for (const operation of operations) {
            if (operation.type === "replace") {
                items.clear();
                for (const item of operation.items) items.set(String(keyOf(item)), item);
                changes.push({ type: "replace", count: operation.items.length });
            } else if (operation.type === "upsert") {
                for (const item of operation.items) {
                    const key = String(keyOf(item));
                    const previous = items.get(key);
                    items.set(key, previous && operation.merge ? { ...previous, ...item } : item);
                    changes.push({ type: previous ? "update" : "insert", key });
                }
            } else if (operation.type === "remove") {
                for (const value of operation.keys) {
                    const key = String(value);
                    if (items.delete(key)) changes.push({ type: "remove", key });
                }
            }
        }
        return notify(changes);
    };

    const requestFlush = (flush) => {
        if (flush === "sync") {
            if (scheduled !== null) cancel(scheduled);
            scheduled = null;
            return run();
        }
        if (scheduled === null && !paused) scheduled = schedule(run);
        return snapshot();
    };

    const enqueue = (operation, options = {}) => {
        if (destroyed) return snapshot();
        pending.push(operation);
        return requestFlush(options.flush);
    };

    return {
        snapshot,
        replace(nextItems, options) {
            return enqueue({ type: "replace", items: [...(nextItems || [])] }, options);
        },
        upsert(nextItems, options = {}) {
            const list = Array.isArray(nextItems) ? nextItems : [nextItems];
            return enqueue({ type: "upsert", items: list.filter(Boolean), merge: options.merge !== false }, options);
        },
        remove(keys, options) {
            const list = Array.isArray(keys) ? keys : [keys];
            return enqueue({ type: "remove", keys: list }, options);
        },
        apply(event, options) {
            if (!event || typeof event !== "object") return snapshot();
            if (event.type === "replace") return this.replace(event.items, options);
            if (event.type === "remove" || event.type === "delete") return this.remove(event.keys ?? event.key, options);
            return this.upsert(event.items ?? event.item, options);
        },
        flush: run,
        subscribe(subscriber, { emitCurrent = false } = {}) {
            subscribers.add(subscriber);
            if (emitCurrent) subscriber(snapshot(), []);
            return () => subscribers.delete(subscriber);
        },
        pause() {
            paused = true;
            if (scheduled !== null) cancel(scheduled);
            scheduled = null;
        },
        resume({ flush = true } = {}) {
            paused = false;
            if (flush && pending.length) return run();
            return snapshot();
        },
        setConnectionState(state, detail = {}) {
            connection = {
                state,
                attempt: Number(detail.attempt || 0),
                error: detail.error || null,
            };
            for (const subscriber of connectionSubscribers) subscriber({ ...connection });
        },
        connectionState() {
            return { ...connection };
        },
        subscribeConnection(subscriber, { emitCurrent = true } = {}) {
            connectionSubscribers.add(subscriber);
            if (emitCurrent) subscriber({ ...connection });
            return () => connectionSubscribers.delete(subscriber);
        },
        destroy() {
            destroyed = true;
            pending = [];
            if (scheduled !== null) cancel(scheduled);
            scheduled = null;
            subscribers.clear();
            connectionSubscribers.clear();
            items.clear();
        },
    };
}
