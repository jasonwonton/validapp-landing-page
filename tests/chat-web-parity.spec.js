import { expect, test } from "@playwright/test";

const HASH = "1QcSHQRnh493V4dIh4eXh1h4kJUI";

async function signIn(page, query = "") {
    await page.goto(`/app/?demo=1&signin=1${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
}

async function openNoah(page) {
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await expect(page.locator('[data-message-id="msg-n3"]')).toBeVisible();
}

const now = () => new Date().toISOString();
const fromNoah = (fields) => ({ chat_id: "chat-noah", sender_user_id: "classmate-2", sender_first_name: "Noah", body: null, status: "active", viewer_is_sender: false, reaction_count: 0, reaction_summary: {}, created_at: now(), updated_at: now(), ...fields });

// Adds messages (and optionally backdates the first) before the demo room opens.
async function withExtraMessages(page, { append = [], yesterdayFirst = false } = {}) {
    await page.evaluate(async ({ append, yesterdayFirst }) => {
        const { DemoAPI } = await import("/app/demo-api.js");
        const original = DemoAPI.prototype.getChatMessages;
        DemoAPI.prototype.getChatMessages = async function (...args) {
            if (!this.__extrasApplied && args[1] === "chat-noah") {
                this.__extrasApplied = true;
                const messages = this.chatMessages["chat-noah"];
                if (yesterdayFirst) {
                    const yesterday = new Date(Date.now() - 86_400_000);
                    yesterday.setHours(12, 0, 0, 0);
                    messages[0].created_at = yesterday.toISOString();
                }
                messages.push(...append);
            }
            return original.apply(this, args);
        };
    }, { append, yesterdayFirst });
}

test("a double-tapped send posts once, clears first, keeps focus and grows to five lines", async ({ page }) => {
    await signIn(page);
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        const original = DemoAPI.prototype.sendChatMessage;
        window.__sends = [];
        DemoAPI.prototype.sendChatMessage = async function (...args) {
            window.__sends.push(args[2]);
            await new Promise((resolve) => setTimeout(resolve, 300));
            return original.apply(this, args);
        };
    });
    await openNoah(page);
    const composer = page.getByRole("textbox", { name: "Message", exact: true });
    await composer.fill("Only once please");
    await page.evaluate(() => {
        const form = document.querySelector(".chat-composer");
        form.requestSubmit();
        form.requestSubmit();
    });
    await expect(composer).toHaveValue("");
    await expect(composer).toBeFocused();
    await expect(page.locator(".chat-message.mine").filter({ hasText: "Only once please" })).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.__sends.length)).toBe(1);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__sends.length)).toBe(1);

    const oneLine = await composer.evaluate((node) => node.getBoundingClientRect().height);
    await composer.fill(Array.from({ length: 12 }, (_, index) => `Line ${index + 1}`).join("\n"));
    const grown = await composer.evaluate((node) => ({ height: node.getBoundingClientRect().height, line: parseFloat(getComputedStyle(node).lineHeight) }));
    expect(grown.height).toBeGreaterThan(oneLine * 2);
    expect(grown.height).toBeLessThanOrEqual(grown.line * 5 + 24);
});

test("day separators, swipe-left time reveal and dated long-press footer", async ({ page }) => {
    await signIn(page);
    await withExtraMessages(page, { yesterdayFirst: true });
    await openNoah(page);
    const separators = page.locator(".chat-day-separator");
    await expect(separators.first()).toContainText("Yesterday");
    await expect(separators.nth(1)).toContainText("Today");
    await expect(separators.first().locator("time")).toHaveAttribute("datetime", /T/);

    const timeline = page.locator(".chat-timeline");
    const message = page.locator('[data-message-id="msg-n3"]');
    const box = await message.boundingBox();
    await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2);
    await page.mouse.down();
    // Every step moves past the 10 px long-press slop, like a real swipe.
    await page.mouse.move(box.x + box.width - 40, box.y + box.height / 2, { steps: 2 });
    await page.mouse.move(box.x + box.width - 140, box.y + box.height / 2, { steps: 4 });
    await expect(timeline).toHaveClass(/is-revealing-times/);
    const revealed = await message.evaluate((node) => ({
        transform: getComputedStyle(node).transform,
        opacity: Number(getComputedStyle(node.querySelector(".chat-reveal-time")).opacity),
        text: node.querySelector(".chat-reveal-time").textContent,
    }));
    expect(revealed.transform).toContain("-86");
    expect(revealed.opacity).toBe(1);
    expect(revealed.text).toMatch(/ago|min|hr/);
    await page.screenshot({ path: test.info().outputPath("time-reveal.png") });
    await page.mouse.up();
    await expect(timeline).not.toHaveClass(/is-revealing-times/);
    // The click that ends a swipe is swallowed; a later tap works normally.
    await page.waitForTimeout(400);
    await message.getByRole("button", { name: "Message actions" }).click();
    await expect(page.locator(".chat-message-actions[open] .chat-action-time")).toContainText(/^Today at /);
});

test("report uses the iOS reason sheet and then offers to leave", async ({ page }) => {
    await signIn(page);
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        window.__reports = [];
        DemoAPI.prototype.reportChat = async (...args) => { window.__reports.push(args); };
    });
    await openNoah(page);
    await page.getByRole("button", { name: "Chat settings", exact: true }).click();
    await page.getByRole("button", { name: "Report chat" }).click();
    const sheet = page.getByRole("dialog", { name: "Why are you reporting Noah Williams?" });
    await expect(sheet).toBeVisible();
    for (const reason of ["Harassment or bullying", "Spam or scam", "Inappropriate content", "Something else"]) {
        await expect(sheet.getByRole("radio", { name: reason })).toBeVisible();
    }
    await expect(sheet.getByRole("button", { name: "Submit Report" })).toBeDisabled();
    await sheet.getByRole("radio", { name: "Something else" }).check();
    await sheet.getByRole("textbox").fill("They keep sending me spam links");
    await sheet.getByRole("button", { name: "Submit Report" }).click();
    const followUp = page.getByRole("dialog", { name: "Report submitted" });
    await expect(followUp).toContainText("Would you also like to leave this chat?");
    await expect(followUp.getByRole("button", { name: "Leave & Delete" })).toBeVisible();
    await followUp.getByRole("button", { name: "Stay" }).click();
    expect(await page.evaluate(() => window.__reports.map((call) => call.slice(1)))).toEqual([["chat-noah", "They keep sending me spam links"]]);
    await expect(page.locator('[data-chat-screen="room"]')).toBeVisible();
    await expect(page.locator("dialog.ui-sheet")).toHaveCount(0);
});

test("photos use the preview and a ThumbHash placeholder in fixed native boxes; links are safe", async ({ page }) => {
    await signIn(page);
    await withExtraMessages(page, { append: [
        fromNoah({ id: "msg-photo", room_sequence: 6, kind: "photo", photo_image_url: "../assets/valid_logo.png", photo_thumbnail_url: "../assets/AppIconV2.png", preview_hash: HASH }),
        fromNoah({ id: "msg-link", room_sequence: 7, kind: "text", body: "Look https://example.com/a?b=1. and javascript:alert(1) <b>x</b>" }),
        fromNoah({ id: "msg-future", room_sequence: 8, kind: "poll_v9", body: "secret" }),
    ] });
    await openNoah(page);
    const photo = page.locator('[data-message-id="msg-photo"] .chat-message-media');
    await expect(photo.locator(".chat-media-hash")).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(photo.locator(".chat-media-image")).toHaveAttribute("src", /AppIconV2\.png$/);
    const box = await photo.boundingBox();
    expect(Math.abs(box.width - box.height)).toBeLessThan(1.5);
    const memento = await page.locator('[data-message-id="msg-n2"] .chat-message-media').boundingBox();
    expect(Math.abs(memento.width / memento.height - 3 / 4)).toBeLessThan(0.02);

    const link = page.locator('[data-message-id="msg-link"] a');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", "https://example.com/a?b=1");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(page.locator('[data-message-id="msg-link"] b')).toHaveCount(0);
    await expect(page.locator('[data-list-key="msg-future"]')).toHaveText("Update Valid to see this message");
    await expect(page.locator('[data-list-key="msg-future"]')).not.toContainText("secret");
});

test("an expired signed photo URL is refreshed once instead of staying broken", async ({ page }) => {
    await signIn(page);
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        const original = DemoAPI.prototype.getChatMessages;
        window.__photoReads = 0;
        DemoAPI.prototype.getChatMessages = async function (...args) {
            const response = await original.apply(this, args);
            if (args[1] !== "chat-noah") return response;
            const at = new Date().toISOString();
            const fresh = window.__photoReads++ > 0;
            const photo = { id: "msg-expiring", chat_id: "chat-noah", room_sequence: 6, sender_user_id: "classmate-2", sender_first_name: "Noah", kind: "photo", photo_image_url: fresh ? "../assets/AppIconV2.png" : "../assets/expired-signed-url.png", status: "active", viewer_is_sender: false, reaction_count: 0, reaction_summary: {}, created_at: at, updated_at: at };
            if (!args[2]?.afterSequence || args[2].afterSequence < 6) response.items.push(photo);
            return response;
        };
    });
    await openNoah(page);
    const image = page.locator('[data-message-id="msg-expiring"] .chat-media-image');
    await expect(image).toHaveAttribute("src", /AppIconV2\.png$/);
    await expect(image).not.toHaveClass(/media-placeholder/);
});

test("the media viewer zooms on double-tap and dismisses on a downward drag", async ({ page }) => {
    await signIn(page);
    await withExtraMessages(page, { append: [
        fromNoah({ id: "msg-photo", room_sequence: 6, kind: "photo", photo_image_url: "../assets/AppIconV2.png", photo_thumbnail_url: "../assets/AppIconV2.png", preview_hash: HASH }),
    ] });
    await openNoah(page);
    await page.locator('[data-message-id="msg-photo"] .chat-message-media').click();
    const viewer = page.getByRole("dialog", { name: "Chat media", exact: true });
    await expect(viewer).toBeVisible();
    // The gesture module loads on first open and resets the stage.
    await expect.poll(() => page.evaluate(() => document.querySelector(".chat-viewer-media")?.hasAttribute("data-valid-runtime-style"))).toBe(true);
    const stage = await page.locator(".chat-viewer-stage").boundingBox();
    const center = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
    await page.mouse.dblclick(center.x, center.y);
    await expect(viewer).toHaveClass(/is-zoomed/);
    await page.mouse.dblclick(center.x, center.y);
    await expect(viewer).not.toHaveClass(/is-zoomed/);
    await page.waitForTimeout(350);

    // A short drag springs back; a long one flies off and closes.
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
        await page.mouse.move(center.x, center.y + step * 10);
        await page.waitForTimeout(30);
    }
    await expect(viewer).toHaveClass(/is-dragging/);
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect(viewer).toBeVisible();
    await expect(viewer).not.toHaveClass(/is-dragging/);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 20, center.y + 180, { steps: 10 });
    await page.mouse.up();
    await expect(viewer).toBeHidden();
});

test("the user event stream closes while hidden and repairs on return", async ({ page }) => {
    await page.goto("/app/?signin=1");
    const result = await page.evaluate(async () => {
        const sources = [];
        class FakeEventSource {
            static CLOSED = 2;
            constructor(url) { this.url = url; this.readyState = 1; this.listeners = {}; this.closed = false; sources.push(this); }
            addEventListener(type, callback) { this.listeners[type] = callback; }
            close() { this.closed = true; this.readyState = 2; }
            emit(payload) { this.listeners.chat?.({ data: JSON.stringify(payload), lastEventId: "" }); }
        }
        window.EventSource = FakeEventSource;
        let hidden = false;
        Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
        const { createChatsView } = await import("/app/chat/index.js");
        const chat = { id: "sse-chat", display_name: "Sam", membership_status: "accepted", accepted_count: 2, status: "active" };
        const calls = { list: 0, chat: 0, messages: [] };
        const api = {
            assetURL: (value) => value,
            chatEventsURL: () => "/chat-events",
            getChats: async () => { calls.list += 1; return { items: [chat] }; },
            getChat: async () => { calls.chat += 1; return { chat, members: [] }; },
            getChatMessages: async (_user, _chat, options) => { calls.messages.push(options); return { items: [], next_before_sequence: null }; },
            markChatRead: async () => ({}),
        };
        const root = document.createElement("div");
        document.body.append(root);
        const view = createChatsView({ root, api, getUser: () => ({ id: "sse-user" }), getConfig: () => ({ enable_chats: true, enable_web_chats: true }) });
        await view.activate({});
        const openedFirst = sources.length === 1 && !sources[0].closed;
        hidden = true;
        document.dispatchEvent(new Event("visibilitychange"));
        const closedWhenHidden = sources[0].closed;
        hidden = false;
        document.dispatchEvent(new Event("visibilitychange"));
        const reopened = sources.length === 2 && !sources[1].closed;
        const listBefore = calls.list;
        await new Promise((resolve) => setTimeout(resolve, 5_100));
        sources[1].emit({ type: "ready", chat_id: null, id: "user:ready" });
        await new Promise((resolve) => setTimeout(resolve, 200));
        const repaired = calls.list > listBefore;
        // A message in another chat updates only that row, not the whole inbox.
        const listAfterReady = calls.list;
        sources[1].emit({ type: "message_created", chat_id: "sse-chat", id: "sse-chat:9", room_sequence: 9 });
        sources[1].emit({ type: "presence_snapshot", chat_id: null, id: "user:presence:1" });
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { openedFirst, closedWhenHidden, reopened, repaired, rowRefreshes: calls.chat, listReloadsAfterEvent: calls.list - listAfterReady };
    });
    expect(result).toEqual({ openedFirst: true, closedWhenHidden: true, reopened: true, repaired: true, rowRefreshes: 1, listReloadsAfterEvent: 0 });
});

test("an open, visible room is reported for notification suppression", async ({ page }) => {
    await signIn(page);
    await page.evaluate(() => {
        window.__activeChats = [];
        window.addEventListener("valid:active-chat", (event) => window.__activeChats.push(event.detail.chatId));
    });
    await openNoah(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.activeChatId)).toBe("chat-noah");
    await page.getByRole("button", { name: "Back to chats" }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.activeChatId ?? null)).toBe(null);
    const reported = await page.evaluate(() => window.__activeChats);
    expect(reported.filter(Boolean)).toEqual(["chat-noah"]);
    expect(reported.at(-1)).toBe(null);
    // Back from the room pops its history entry instead of stacking a duplicate list entry.
    await openNoah(page);
    const depth = await page.evaluate(() => history.length);
    await page.getByRole("button", { name: "Back to chats" }).click();
    await expect(page).not.toHaveURL(/chat=chat-noah/);
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await expect.poll(() => page.evaluate(() => history.length)).toBe(depth);
});

test("browser Back from a room stops typing and clears the active room", async ({ page }) => {
    await signIn(page);
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        window.__typing = [];
        DemoAPI.prototype.setChatTyping = async (_user, chatId, typing) => { window.__typing.push([chatId, typing]); };
    });
    await openNoah(page);
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("half a thought");
    await expect.poll(() => page.evaluate(() => window.__typing)).toEqual([["chat-noah", true]]);
    await page.goBack();
    await expect(page.locator('[data-chat-screen="list"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__typing)).toEqual([["chat-noah", true], ["chat-noah", false]]);
    expect(await page.evaluate(() => document.documentElement.dataset.activeChatId ?? null)).toBe(null);
});

test("an Opus-only recorder sends voice through the media ingest", async ({ page }) => {
    await page.addInitScript(() => {
        const stream = { getTracks: () => [{ stop() {} }] };
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => stream } });
        class Recorder extends EventTarget {
            static isTypeSupported(type) { return type.startsWith("audio/webm"); }
            constructor(recordingStream, options) { super(); this.stream = recordingStream; this.mimeType = options.mimeType; this.state = "inactive"; }
            start() { this.state = "recording"; }
            stop() {
                this.state = "inactive";
                this.dispatchEvent(new MessageEvent("dataavailable", { data: new Blob(["opus-voice"], { type: this.mimeType }) }));
                this.dispatchEvent(new Event("stop"));
            }
        }
        Object.defineProperty(window, "MediaRecorder", { value: Recorder, configurable: true });
    });
    await signIn(page, "&ingest=1");
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        window.__ingest = [];
        for (const name of ["createMediaIngest", "finalizeMediaIngest", "getMediaIngest", "sendChatMessage", "createChatMediaUpload"]) {
            const original = DemoAPI.prototype[name];
            DemoAPI.prototype[name] = async function (...args) { window.__ingest.push([name, structuredClone(args.slice(1))]); return original.apply(this, args); };
        }
    });
    await openNoah(page);
    const mic = page.locator(".chat-mic-button");
    const box = await mic.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.getByRole("button", { name: "Stop recording and preview" })).toBeVisible();
    await page.mouse.up();
    await expect(page.locator(".chat-voice-player")).toBeVisible();
    await expect(page.getByRole("button", { name: "Playback speed 1×" })).toBeVisible();
    await page.locator("[data-send-voice]").click();
    await expect(page.locator(".chat-message.mine .chat-audio-message").last()).toBeVisible();
    const log = await page.evaluate(() => window.__ingest);
    const names = log.map(([name]) => name);
    expect(names).not.toContain("createChatMediaUpload");
    expect(names.slice(0, 2)).toEqual(["createMediaIngest", "finalizeMediaIngest"]);
    expect(names).toContain("getMediaIngest");
    const created = log.find(([name]) => name === "createMediaIngest")[1][0];
    expect(created).toMatchObject({ purpose: "chat", content_type: "audio/webm;codecs=opus", view_once: false });
    const sent = log.filter(([name]) => name === "sendChatMessage").at(-1)[1][1];
    expect(sent.media_asset_id).toMatch(/-segment-1$/);
});

async function installCalls(page) {
    await page.goto("/app/?demo=1");
    await page.evaluate(async () => {
        window.__callLog = [];
        const log = window.__callLog;
        class FakeTrack {
            constructor(kind) { this.kind = kind; }
            attach() { const element = document.createElement(this.kind === "audio" ? "audio" : "video"); element.play = async () => {}; return element; }
            detach() {}
        }
        class FakeRoom {
            constructor() {
                window.__fakeRoom = this;
                this.handlers = new Map();
                this.remoteParticipants = new Map();
                this.localParticipant = {
                    trackPublications: new Map(),
                    setMicrophoneEnabled: async () => {},
                    setCameraEnabled: async (enabled, options) => {
                        log.push(["camera", enabled, options?.facingMode]);
                        if (enabled) this.localParticipant.trackPublications.set("camera", { track: new FakeTrack("video") });
                        else this.localParticipant.trackPublications.delete("camera");
                    },
                };
            }
            on(name, handler) { this.handlers.set(name, handler); return this; }
            async connect() {}
            async disconnect() { log.push(["disconnect"]); }
            async startAudio() {}
        }
        const RoomEvent = { TrackSubscribed: "trackSubscribed", TrackUnsubscribed: "trackUnsubscribed", TrackMuted: "trackMuted", TrackUnmuted: "trackUnmuted", LocalTrackPublished: "localTrackPublished", LocalTrackUnpublished: "localTrackUnpublished", ParticipantConnected: "participantConnected", ParticipantDisconnected: "participantDisconnected", Reconnecting: "reconnecting", Reconnected: "reconnected", Disconnected: "disconnected" };
        window.__VALID_LIVEKIT_LOADER__ = async () => ({ Room: FakeRoom, RoomEvent });
        window.__FakeTrack = FakeTrack;
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
        Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async (type) => { log.push(["wakeLock", type]); return { release: async () => log.push(["wakeLockReleased"]), addEventListener() {} }; } } });
        const call = { id: "call-1", chat_id: "chat-1", initiated_by_user_id: "user-1", media_type: "audio", state: "ringing", caller_name: "Maya", viewer_invitation_state: "accepted" };
        const api = {
            startCall: async (_user, _chat, media) => { call.media_type = media; return structuredClone(call); },
            getCall: async () => structuredClone(call),
            joinCall: async () => ({ call: structuredClone({ ...call, state: "active" }), server_url: "wss://livekit.test", access_token: "token" }),
            enableCallCamera: async () => ({ camera_slot_reserved: true, camera_slot_reservation_id: "slot-1" }),
            disableCallCamera: async () => ({}),
            endCall: async () => { log.push(["end"]); return { ...call, state: "ended" }; },
            leaveCall: async () => { log.push(["leave"]); return { ...call, state: "ended" }; },
        };
        const { createCallsController } = await import("/app/calls/index.js");
        window.__calls = createCallsController({ api, getUser: () => ({ id: "user-1" }), getConfig: () => ({ enable_calls: true, enable_web_calls: true }), showToast: () => {} });
    });
}

test("calls keep the screen awake, confirm before Esc leaves, minimize to a bar and diff tiles", async ({ page }) => {
    await installCalls(page);
    await page.evaluate(() => __calls.start("audio", { id: "chat-1", display_name: "Maya", accepted_count: 2 }));
    await expect(page.locator(".call-overlay")).toBeVisible();
    await expect.poll(() => page.evaluate(() => __callLog.some(([name, type]) => name === "wakeLock" && type === "screen"))).toBe(true);
    await expect(page.locator(".call-note")).toHaveText("Keep Valid open during your call.");

    await page.evaluate(() => {
        __fakeRoom.remoteParticipants.set("user-2", { identity: "user-2", name: "Maya", trackPublications: new Map([["audio", { track: new __FakeTrack("audio") }]]) });
        __fakeRoom.handlers.get("participantConnected")();
        window.__firstAudio = document.querySelector(".call-audio-track");
        __fakeRoom.handlers.get("trackMuted")();
        __fakeRoom.handlers.get("trackUnmuted")();
    });
    expect(await page.evaluate(() => document.querySelector(".call-audio-track") === window.__firstAudio && window.__firstAudio.isConnected)).toBe(true);

    await page.keyboard.press("Escape");
    const leave = page.getByRole("dialog", { name: "Leave call?" });
    await expect(leave).toBeVisible();
    await leave.getByRole("button", { name: "Stay" }).click();
    await expect(page.locator(".call-overlay")).toBeVisible();
    expect(await page.evaluate(() => __callLog.some(([name]) => name === "leave" || name === "end"))).toBe(false);

    await page.getByRole("button", { name: "Minimize call" }).click();
    await expect(page.locator(".call-overlay")).toBeHidden();
    const bar = page.getByRole("region", { name: "Ongoing call" });
    await expect(bar).toBeVisible();
    await bar.getByRole("button", { name: "Return to call with Maya" }).click();
    await expect(page.locator(".call-overlay")).toBeVisible();

    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Leave call?" }).getByRole("button", { name: "Leave" }).click();
    await expect(page.locator(".call-overlay")).toBeHidden();
    await expect.poll(() => page.evaluate(() => __callLog.some(([name]) => name === "wakeLockReleased"))).toBe(true);
});

test("the front-camera self view is mirrored and can flip during video", async ({ page }) => {
    await installCalls(page);
    await page.evaluate(() => __calls.start("video", { id: "chat-1", display_name: "Maya", accepted_count: 2 }));
    await expect(page.locator(".call-video-track.mirrored")).toHaveCount(1);
    await page.getByRole("button", { name: "Switch camera" }).click();
    await expect(page.locator(".call-video-track.mirrored")).toHaveCount(0);
    expect(await page.evaluate(() => __callLog.filter(([name]) => name === "camera").at(-1))).toEqual(["camera", true, "environment"]);
    await page.getByRole("button", { name: "End call", exact: true }).click();
});
