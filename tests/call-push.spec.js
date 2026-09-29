import { expect, test } from "@playwright/test";

// Drives the real service worker in Chromium: pushes are delivered through the
// DevTools protocol exactly as a push service would, and the notifications the
// worker shows are recorded inside the worker.
test.skip(({ browserName }) => browserName !== "chromium", "CDP push delivery is Chromium-only");

const CALL = { type: "incoming_call", call_id: "call-7", chat_id: "chat-noah", caller_name: "Noah", media_type: "video", has_video: true };
const ringing = {
    title: "Noah is calling", body: "Incoming video call", type: "incoming_call",
    url: "/app/?signin=1&tab=chats&chat=chat-noah&call=call-7", tag: "valid-call-call-7", data: CALL,
};
const ended = (reason, body) => ({
    title: "Noah", body, type: "call_ended", url: "/app/?signin=1&tab=chats&chat=chat-noah", tag: "valid-call-call-7",
    data: { type: "call_ended", call_id: "call-7", chat_id: "chat-noah", reason, media_type: "video" },
});

async function installWorker(context, page) {
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(["notifications"], { origin });
    const cdp = await context.newCDPSession(page);
    const registrations = new Map();
    cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations: updated }) => {
        for (const registration of updated) registrations.set(registration.scopeURL, registration.registrationId);
    });
    await cdp.send("ServiceWorker.enable");
    const started = context.waitForEvent("serviceworker");
    await page.evaluate(async () => {
        await navigator.serviceWorker.register("/app/service-worker.js", { scope: "/app/" });
        const registration = await navigator.serviceWorker.getRegistration("/app/");
        const worker = registration.installing || registration.waiting || registration.active;
        if (worker.state !== "activated") await new Promise((resolve) => worker.addEventListener("statechange", () => worker.state === "activated" && resolve()));
    });
    const serviceWorker = context.serviceWorkers()[0] || await started;
    // Headless Chromium does not reliably keep displayed notifications for
    // getNotifications(), so record what the worker asked the browser to show.
    await serviceWorker.evaluate(() => {
        self.__shown = [];
        const show = self.registration.showNotification.bind(self.registration);
        self.registration.showNotification = (title, options = {}) => {
            self.__shown.push({
                title, body: options.body, tag: options.tag, silent: Boolean(options.silent), renotify: Boolean(options.renotify),
                requireInteraction: Boolean(options.requireInteraction), actions: (options.actions || []).map((action) => action.action),
                vibrate: options.vibrate || [], url: options.data?.url,
            });
            return show(title, options);
        };
    });
    await expect.poll(() => registrations.get(`${origin}/app/`)).toBeTruthy();
    const registrationId = registrations.get(`${origin}/app/`);
    const shown = () => serviceWorker.evaluate(() => self.__shown);
    return {
        shown,
        async push(payload) {
            const before = (await shown()).length;
            await cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId, data: JSON.stringify(payload) });
            return before;
        },
    };
}

test("with Valid closed, a call push rings with Answer/Decline and call_ended retires it", async ({ context, page }) => {
    // Not an /app/ window: the worker sees no open Valid page.
    await page.goto("/terms.html");
    const worker = await installWorker(context, page);

    await worker.push(ringing);
    await expect.poll(async () => (await worker.shown()).length).toBe(1);
    const [ring] = await worker.shown();
    expect(ring).toMatchObject({ title: "Noah is calling", body: "Incoming video call", tag: "valid-call-call-7", renotify: true, requireInteraction: true, actions: ["answer", "decline"] });
    expect(ring.vibrate.length).toBeGreaterThanOrEqual(3);
    const url = new URL(ring.url);
    expect([url.pathname, url.searchParams.get("chat"), url.searchParams.get("call")]).toEqual(["/app/", "chat-noah", "call-7"]);

    await worker.push(ended("missed", "Missed video call"));
    await expect.poll(async () => (await worker.shown()).length).toBe(2);
    const missed = (await worker.shown())[1];
    // Same tag: the browser replaces the ringing notification with this one.
    expect(missed).toMatchObject({ title: "Noah", body: "Missed video call", tag: "valid-call-call-7", silent: true, renotify: false, requireInteraction: false, actions: [], vibrate: [] });
    expect(new URL(missed.url).searchParams.has("call")).toBe(false);
});

test("with Valid on screen, the page rings instead of a system notification", async ({ context, page }) => {
    await page.goto("/app/?demo=1");
    const worker = await installWorker(context, page);
    await page.evaluate(() => {
        window.__workerMessages = [];
        navigator.serviceWorker.addEventListener("message", (event) => window.__workerMessages.push(event.data));
    });

    await worker.push(ringing);
    await expect.poll(() => page.evaluate(() => window.__workerMessages)).toContainEqual({ type: "VALID_INCOMING_CALL", callId: "call-7", chatId: "chat-noah" });

    await worker.push(ended("answered", "Video call answered on another device"));
    await expect.poll(() => page.evaluate(() => window.__workerMessages.map((m) => m.type))).toContain("VALID_CALL_ENDED");
    expect(await worker.shown()).toEqual([]);
});
