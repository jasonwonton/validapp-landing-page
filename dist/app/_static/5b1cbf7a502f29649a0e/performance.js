const SAMPLE_RATE = 0.02;
const REPORT_DELAY_MS = 60_000;

function randomHex(bytes = 32) {
    const values = crypto.getRandomValues(new Uint8Array(bytes));
    return [...values].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function clientInstanceId() {
    const key = "valid:pwa:performance-instance";
    try {
        const existing = localStorage.getItem(key);
        if (/^[a-f0-9]{64}$/.test(existing || "")) return existing;
        const created = randomHex();
        localStorage.setItem(key, created);
        return created;
    } catch (_) {
        return randomHex();
    }
}

function sessionIsSampled() {
    const key = "valid:pwa:performance-sampled";
    try {
        const existing = sessionStorage.getItem(key);
        if (existing !== null) return existing === "1";
        const sampled = crypto.getRandomValues(new Uint32Array(1))[0] / 0xffffffff < SAMPLE_RATE;
        sessionStorage.setItem(key, sampled ? "1" : "0");
        return sampled;
    } catch (_) {
        return Math.random() < SAMPLE_RATE;
    }
}

function displayMode() {
    if (matchMedia("(display-mode: standalone)").matches) return "standalone";
    if (matchMedia("(display-mode: fullscreen)").matches) return "fullscreen";
    if (matchMedia("(display-mode: minimal-ui)").matches) return "minimal-ui";
    return "browser";
}

function observe(type, callback, options = {}) {
    if (!globalThis.PerformanceObserver?.supportedEntryTypes?.includes(type)) return null;
    try {
        const observer = new PerformanceObserver((list) => callback(list.getEntries()));
        observer.observe({ type, buffered: true, ...options });
        return observer;
    } catch (_) {
        return null;
    }
}

function rounded(value) {
    return String(Math.max(0, Math.round(Number(value) || 0)));
}

export function startPerformanceMonitoring({ disabled = false, getRoute = () => "unknown" } = {}) {
    if (disabled || !sessionIsSampled()) return () => null;

    const metrics = {
        lcp: 0,
        cls: 0,
        longTaskCount: 0,
        longTaskMax: 0,
        longAnimationFrameCount: 0,
        longAnimationFrameMax: 0,
        interactions: new Map(),
    };
    const observers = [
        observe("largest-contentful-paint", (entries) => {
            for (const entry of entries) metrics.lcp = Math.max(metrics.lcp, entry.startTime || 0);
        }),
        observe("layout-shift", (entries) => {
            for (const entry of entries) if (!entry.hadRecentInput) metrics.cls += entry.value || 0;
        }),
        observe("longtask", (entries) => {
            metrics.longTaskCount += entries.length;
            for (const entry of entries) metrics.longTaskMax = Math.max(metrics.longTaskMax, entry.duration || 0);
        }),
        observe("long-animation-frame", (entries) => {
            metrics.longAnimationFrameCount += entries.length;
            for (const entry of entries) metrics.longAnimationFrameMax = Math.max(metrics.longAnimationFrameMax, entry.duration || 0);
        }),
        observe("event", (entries) => {
            for (const entry of entries) {
                if (!entry.interactionId) continue;
                metrics.interactions.set(entry.interactionId, Math.max(metrics.interactions.get(entry.interactionId) || 0, entry.duration || 0));
            }
        }, { durationThreshold: 40 }),
    ].filter(Boolean);

    let sent = false;
    const report = () => {
        if (sent) return;
        sent = true;
        observers.forEach((observer) => observer.disconnect());
        const meta = document.querySelector('meta[name="valid-app-version"]');
        const appVersion = meta?.content || "web-unknown";
        const buildNumber = appVersion.match(/\d+/)?.[0] || "0";
        const inp = Math.max(0, ...metrics.interactions.values());
        const context = {
            app_version: appVersion,
            build_number: buildNumber,
            client_instance_id: clientInstanceId(),
            distribution_channel: "web_pwa",
            flow: "performance",
            stage: "page_summary",
            environment: location.hostname === "validapp.lol" ? "production" : "development",
            route: String(getRoute() || "unknown").slice(0, 64),
            display_mode: displayMode(),
            effective_connection: String(navigator.connection?.effectiveType || "unknown"),
            device_memory_gb: String(navigator.deviceMemory || "unknown"),
            network_connected: String(navigator.onLine),
            inp_ms: rounded(inp),
            lcp_ms: rounded(metrics.lcp),
            cls_milli: rounded(metrics.cls * 1000),
            long_task_count: rounded(metrics.longTaskCount),
            long_task_max_ms: rounded(metrics.longTaskMax),
            long_animation_frame_count: rounded(metrics.longAnimationFrameCount),
            long_animation_frame_max_ms: rounded(metrics.longAnimationFrameMax),
            dom_nodes: rounded(document.getElementsByTagName("*").length),
        };
        const body = JSON.stringify({
            id: crypto.randomUUID(),
            event: "performance.page_summary",
            severity: "warning",
            message: "Sampled PWA performance summary.",
            occurred_at: new Date().toISOString(),
            context,
            breadcrumbs: [],
        });
        const endpoint = "/api/v1/client-logs";
        const queued = navigator.sendBeacon?.(endpoint, new Blob([body], { type: "application/json" }));
        if (!queued) fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, credentials: "include", keepalive: true }).catch(() => null);
    };

    const timer = setTimeout(report, REPORT_DELAY_MS);
    addEventListener("pagehide", report, { once: true });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") report();
    });
    return () => {
        clearTimeout(timer);
        observers.forEach((observer) => observer.disconnect());
    };
}
