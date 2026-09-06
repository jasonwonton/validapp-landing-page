import { expect, test } from "@playwright/test";

async function installCallHarness(page) {
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
                this.handlers = new Map();
                this.remoteParticipants = new Map();
                this.localParticipant = {
                    name: "You",
                    trackPublications: new Map(),
                    setMicrophoneEnabled: async (enabled) => { log.push(["microphone", enabled]); },
                    setCameraEnabled: async (enabled) => {
                        log.push(["camera", enabled]);
                        if (enabled) this.localParticipant.trackPublications.set("camera", { track: new FakeTrack("video") });
                        else this.localParticipant.trackPublications.delete("camera");
                    },
                };
            }
            on(name, handler) { this.handlers.set(name, handler); return this; }
            async connect(url, token) { log.push(["connect", url, token]); }
            async disconnect() { log.push(["disconnect"]); }
            async startAudio() { log.push(["startAudio"]); }
        }
        const RoomEvent = {
            TrackSubscribed: "trackSubscribed", TrackUnsubscribed: "trackUnsubscribed",
            TrackMuted: "trackMuted", TrackUnmuted: "trackUnmuted",
            LocalTrackPublished: "localTrackPublished", LocalTrackUnpublished: "localTrackUnpublished",
            ParticipantConnected: "participantConnected", ParticipantDisconnected: "participantDisconnected",
            Reconnecting: "reconnecting", Reconnected: "reconnected", Disconnected: "disconnected",
        };
        window.__VALID_LIVEKIT_LOADER__ = async () => ({ Room: FakeRoom, RoomEvent });
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
            getUserMedia: async (constraints) => {
                log.push(["permission", constraints]);
                return { getTracks: () => [{ stop: () => log.push(["permissionStopped"]) }] };
            },
        } });
        const makeCall = (overrides = {}) => ({
            id: "call-1", chat_id: "chat-1", initiated_by_user_id: "user-1",
            media_type: "audio", state: "ringing", caller_name: "Maya",
            viewer_invitation_state: "accepted", ...overrides,
        });
        const calls = new Map([["incoming-1", makeCall({ id: "incoming-1", initiated_by_user_id: "user-2", viewer_invitation_state: "invited" })]]);
        window.__callAPI = {
            startCall: async (_user, chat, media, request) => { log.push(["start", chat, media, request]); const call = makeCall({ media_type: media }); calls.set(call.id, call); return call; },
            getCall: async (_user, callId) => { log.push(["get", callId]); return structuredClone(calls.get(callId)); },
            acceptCall: async (_user, callId) => { log.push(["accept", callId]); const call = calls.get(callId); Object.assign(call, { state: "active", viewer_invitation_state: "accepted" }); return structuredClone(call); },
            declineCall: async (_user, callId) => { log.push(["decline", callId]); return makeCall({ id: callId, state: "declined" }); },
            joinCall: async (_user, callId) => { log.push(["join", callId]); return { call: structuredClone(calls.get(callId) || makeCall({ id: callId })), server_url: "wss://livekit.test", access_token: "token", room_name: callId, camera_slot_reserved: false, camera_slot_reservation_id: null }; },
            enableCallCamera: async (_user, callId, request) => { log.push(["enableCamera", callId, request]); return { call: calls.get(callId), camera_slot_reserved: true, camera_slot_reservation_id: "slot-1" }; },
            disableCallCamera: async (_user, callId, slot) => { log.push(["disableCamera", callId, slot]); return { call: calls.get(callId), camera_slot_reserved: false }; },
            endCall: async (_user, callId) => { log.push(["end", callId]); return makeCall({ id: callId, state: "ended" }); },
            leaveCall: async (_user, callId) => { log.push(["leave", callId]); return makeCall({ id: callId, state: "ended" }); },
        };
        const { createCallsController } = await import("/app/calls/index.js");
        window.__calls = createCallsController({
            api: window.__callAPI,
            getUser: () => ({ id: "user-1" }),
            getConfig: () => ({ enable_calls: true, enable_web_calls: true }),
            showToast: (message) => log.push(["toast", message]),
        });
    });
}

test("open-app voice calls preflight media, use idempotent server state, and end cleanly", async ({ page }) => {
    await installCallHarness(page);
    await page.evaluate(() => window.__calls.start("audio", { id: "chat-1", display_name: "Maya", accepted_count: 2 }));
    await expect(page.locator(".call-overlay")).toBeVisible();
    await expect(page.locator("[data-call-title]")).toHaveText("Maya");
    const log = await page.evaluate(() => window.__callLog);
    expect(log.findIndex(([name]) => name === "permissionStopped")).toBeLessThan(log.findIndex(([name]) => name === "start"));
    expect(log.map(([name]) => name)).toEqual(expect.arrayContaining(["start", "join", "connect", "microphone"]));
    await page.locator("[data-call-audio]").click();
    await expect(page.locator("[data-call-audio]")).toHaveText("Mic off");
    await page.locator("[data-call-hangup]").click();
    await expect(page.locator(".call-overlay")).not.toBeVisible();
    expect(await page.evaluate(() => window.__callLog.some(([name, id]) => name === "end" && id === "call-1"))).toBe(true);
});

test("video calls reserve and release the authoritative camera slot", async ({ page }) => {
    await installCallHarness(page);
    await page.evaluate(() => window.__calls.start("video", { id: "chat-1", display_name: "Maya", accepted_count: 2 }));
    await expect(page.locator("[data-call-video]")).toHaveText("Camera on");
    await page.locator("[data-call-video]").click();
    await expect(page.locator("[data-call-video]")).toHaveText("Camera off");
    const names = await page.evaluate(() => window.__callLog.map(([name]) => name));
    expect(names).toEqual(expect.arrayContaining(["enableCamera", "camera", "disableCamera"]));
    await page.locator("[data-call-hangup]").click();
});

test("foreground call events show an accept/decline surface and accept before joining", async ({ page }) => {
    await installCallHarness(page);
    await page.evaluate(() => window.__calls.handleRealtimeEvent({ type: "call_started", call_id: "incoming-1", actor_user_id: "user-2" }));
    await expect(page.locator("[data-call-status]")).toContainText("Incoming voice call");
    await page.locator("[data-call-accept]").click();
    await expect(page.locator("[data-call-active-actions]")).toBeVisible();
    const names = await page.evaluate(() => window.__callLog.map(([name]) => name));
    expect(names.indexOf("accept")).toBeLessThan(names.indexOf("join"));
    await page.locator("[data-call-hangup]").click();
});

test("web call adapter matches the released call-control contract", async ({ page }) => {
    await page.goto("/app/");
    const requests = await page.evaluate(async () => {
        const { ValidAPI } = await import("/app/api.js");
        const api = new ValidAPI();
        const seen = [];
        api.request = async (path, options = {}) => { seen.push([path, options.method || "GET", options.body ? JSON.parse(options.body) : null]); return {}; };
        await api.startCall("u", "c", "video", "request-1");
        await api.getCall("u", "call");
        await api.acceptCall("u", "call");
        await api.declineCall("u", "call");
        await api.joinCall("u", "call");
        await api.enableCallCamera("u", "call", "camera-request");
        await api.disableCallCamera("u", "call", "slot");
        await api.leaveCall("u", "call");
        await api.endCall("u", "call");
        return seen;
    });
    expect(requests).toEqual([
        ["/users/u/chats/c/calls", "POST", { client_request_id: "request-1", media_type: "video" }],
        ["/users/u/calls/call", "GET", null],
        ["/users/u/calls/call/accept", "POST", null],
        ["/users/u/calls/call/decline", "POST", null],
        ["/users/u/calls/call/join", "POST", { camera_slot_protocol_version: 1 }],
        ["/users/u/calls/call/camera/enable", "POST", { client_request_id: "camera-request" }],
        ["/users/u/calls/call/camera/disable", "POST", { reservation_id: "slot" }],
        ["/users/u/calls/call/leave", "POST", null],
        ["/users/u/calls/call/end", "POST", null],
    ]);
});
