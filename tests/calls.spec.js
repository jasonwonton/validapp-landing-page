import { expect, test } from "@playwright/test";

async function installToneProbe(page) {
    await page.evaluate(()=>{
        window.__toneLog=[];
        window.AudioContext=class {
            constructor(){this.state='running';__toneLog.push('prepare');}
            async resume(){if(window.__blockTone)throw new DOMException('Tap required','NotAllowedError');}
            async close(){__toneLog.push('close');}
            createBuffer(){return {copyToChannel(){}};}
            createGain(){return {gain:{value:0},connect(){},disconnect(){}};}
            createBufferSource(){return {connect(gain){return gain;},start(){__toneLog.push('start');},stop(){__toneLog.push('stop');},disconnect(){}};}
        };
    });
}

test('outgoing native ringback loops once, stops on answer and never restarts',async({page})=>{
    await installCallHarness(page);await installToneProbe(page);
    await page.evaluate(()=>__calls.start('audio',{id:'chat-1',accepted_count:2}));
    await expect(page.locator('[data-call-status]')).toHaveText('Waiting for an answer…');
    await page.evaluate(()=>__fakeRoom.handlers.get('localTrackPublished')());
    expect(await page.evaluate(()=>__toneLog.filter(v=>v==='start').length)).toBe(1);
    await page.evaluate(async()=>{
        __callAPI.getCall=async()=>({id:'call-1',state:'active'});
        await __calls.handleRealtimeEvent({type:'call_updated',call_id:'call-1'});
        __fakeRoom.remoteParticipants.set('peer',{name:'Peer',trackPublications:new Map()});
        __fakeRoom.handlers.get('participantConnected')();
    });
    await expect(page.locator('[data-call-status]')).toHaveText('Connected');
    await page.evaluate(()=>{__fakeRoom.remoteParticipants.clear();__fakeRoom.handlers.get('participantDisconnected')();});
    expect(await page.evaluate(()=>__toneLog)).toEqual(['prepare','start','stop']);
    await page.locator('[data-call-hangup]').click();
    expect(await page.evaluate(()=>__toneLog.at(-1))).toBe('close');
});

test('no-answer result remains visible and releases ringback',async({page})=>{
    await installCallHarness(page);await installToneProbe(page);
    await page.evaluate(async()=>{
        await __calls.start('audio',{id:'chat-1',accepted_count:2});
        __callAPI.getCall=async()=>({id:'call-1',state:'missed'});
        await __calls.handleRealtimeEvent({type:'call_ended',call_id:'call-1'});
    });
    await expect(page.locator('[data-call-status]')).toHaveText('No answer');
    await expect(page.locator('[data-call-dismiss]')).toBeVisible();
    await expect(page.locator('.call-note')).not.toBeVisible();
    await page.screenshot({path:test.info().outputPath('no-answer.png')});
    expect(await page.evaluate(()=>__toneLog)).toEqual(['prepare','start','stop','close']);
    await page.locator('[data-call-dismiss]').click();
    await expect(page.locator('.call-overlay')).not.toBeVisible();
});

for(const [state,message] of [['declined','Call declined'],['failed','Could not connect'],['ended','Call ended']]) {
    test(`server ${state} stops the tone and explains the outcome`,async({page})=>{
        await installCallHarness(page);await installToneProbe(page);
        await page.evaluate(async state=>{
            await __calls.start('audio',{id:'chat-1',accepted_count:2});
            __callAPI.getCall=async()=>({id:'call-1',state});
            await __calls.handleRealtimeEvent({type:'call_ended',call_id:'call-1'});
        },state);
        await expect(page.locator('[data-call-status]')).toHaveText(message);
        expect(await page.evaluate(()=>__toneLog)).toEqual(['prepare','start','stop','close']);
    });
}

test('blocked ringback offers a tap; incoming calls do not play outgoing tone',async({page})=>{
    await installCallHarness(page);await installToneProbe(page);
    await page.evaluate(async()=>{window.__blockTone=true;await __calls.start('audio',{id:'chat-1',accepted_count:2});});
    await expect(page.locator('[data-call-enable-sound]')).toBeVisible();
    await page.evaluate(()=>{window.__blockTone=false;});
    await page.locator('[data-call-enable-sound]').click();
    await expect(page.locator('[data-call-enable-sound]')).not.toBeVisible();
    await page.locator('[data-call-hangup]').click();
    await page.evaluate(async()=>{__toneLog.length=0;await __calls.open('incoming-1');});
    await page.locator('[data-call-accept]').click();
    expect(await page.evaluate(()=>__toneLog)).toEqual([]);
    await page.locator('[data-call-hangup]').click();
});

async function installCallHarness(page, { chatUI = false } = {}) {
    await page.goto(chatUI ? '/app/?demo=1&signin=1&calls=1' : "/app/?demo=1");
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
            async connect(url, token) { log.push(["connect", url, token]); if (window.__delayConnect) await new Promise(resolve => { window.__resolveConnect = resolve; }); }
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
        window.__FakeTrack = FakeTrack;
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
            onCallChanged: (call) => log.push(['history', call.chat_id]),
        });
    });
}

test('reconnection pauses waiting tone and cannot restart it after answer',async({page})=>{
    await installCallHarness(page);await installToneProbe(page);
    await page.evaluate(async()=>{
        await __calls.start('audio',{id:'chat-1',accepted_count:2});
        __fakeRoom.handlers.get('reconnecting')();
    });
    await expect(page.locator('[data-call-status]')).toHaveText('Reconnecting…');
    expect(await page.evaluate(()=>__toneLog)).toEqual(['prepare','start','stop']);
    await page.evaluate(async()=>{
        __fakeRoom.handlers.get('reconnected')();
        __callAPI.getCall=async()=>({id:'call-1',state:'active'});
        await __calls.handleRealtimeEvent({type:'call_updated',call_id:'call-1'});
        __fakeRoom.handlers.get('reconnecting')();__fakeRoom.handlers.get('reconnected')();
    });
    expect(await page.evaluate(()=>__toneLog)).toEqual(['prepare','start','stop','start','stop']);
    await page.locator('[data-call-hangup]').click();
});

test('ringback stops at server deadline even when the status request hangs',async({page})=>{
    await installCallHarness(page);await installToneProbe(page);await page.clock.install();
    await page.evaluate(async()=>{
        const original=__callAPI.joinCall;
        __callAPI.joinCall=async(...args)=>{
            const response=await original(...args);
            response.call.ringing_expires_at=new Date(Date.now()+1000).toISOString();return response;
        };
        __callAPI.getCall=()=>new Promise(()=>{});
        await __calls.start('audio',{id:'chat-1',accepted_count:2});
    });
    await page.clock.fastForward(5001);
    expect(await page.evaluate(()=>__toneLog)).toEqual(['prepare','start','stop']);
    await expect(page.locator('[data-call-status]')).toHaveText('Checking call status…');
    await page.locator('[data-call-hangup]').click();
});

test("open-app voice calls preflight media, use idempotent server state, and end cleanly", async ({ page }) => {
    await installCallHarness(page);
    await page.evaluate(() => window.__calls.start("audio", { id: "chat-1", display_name: "Maya", accepted_count: 2 }));
    await expect(page.locator(".call-overlay")).toBeVisible();
    await expect(page.locator("[data-call-title]")).toHaveText("Maya");
    await page.screenshot({path: test.info().outputPath('voice-call.png')});
    const log = await page.evaluate(() => window.__callLog);
    expect(log.findIndex(([name]) => name === "permissionStopped")).toBeLessThan(log.findIndex(([name]) => name === "start"));
    expect(log.map(([name]) => name)).toEqual(expect.arrayContaining(["start", "join", "connect", "microphone"]));
    await page.locator("[data-call-audio]").click();
    await expect(page.locator("[data-call-audio]")).toHaveAttribute('aria-label', 'Unmute');
    await page.locator("[data-call-hangup]").click();
    await expect(page.locator(".call-overlay")).not.toBeVisible();
    expect(await page.evaluate(() => window.__callLog.some(([name, id]) => name === "end" && id === "call-1"))).toBe(true);
});

test("video calls reserve and release the authoritative camera slot", async ({ page }) => {
    await installCallHarness(page);
    await page.evaluate(() => window.__calls.start("video", { id: "chat-1", display_name: "Maya", accepted_count: 2 }));
    await expect(page.locator("[data-call-video]")).toHaveAttribute('aria-label', 'Turn camera off');
    await page.locator("[data-call-video]").click();
    await expect(page.locator("[data-call-video]")).toHaveAttribute('aria-label', 'Turn camera on');
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

test('hanging up during microphone permission prevents a late outgoing call', async ({ page }) => {
    await installCallHarness(page);
    await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.__grant = () => resolve({getTracks: () => [{stop() { __callLog.push(['lateTrackStopped']); }}]}); });
        window.__pendingStart = __calls.start('audio', {id:'chat-1',accepted_count:2});
    });
    await page.getByRole('button', {name:'End call',exact:true}).click();
    await page.evaluate(async () => { __grant(); await __pendingStart; });
    expect(await page.evaluate(() => __callLog.map(([name]) => name))).toContain('lateTrackStopped');
    expect(await page.evaluate(() => __callLog.some(([name]) => name === 'start'))).toBe(false);
    await expect(page.locator('.call-overlay')).toBeHidden();
});

test('hangup while start is in flight refreshes history after the late call is cancelled', async ({ page }) => {
    await installCallHarness(page);
    await page.evaluate(() => {
        const start = __callAPI.startCall;
        __callAPI.startCall = async (...args) => { await new Promise(resolve => { window.__releaseStart = resolve; }); return start(...args); };
        window.__pendingStart = __calls.start('audio', { id: 'chat-1', accepted_count: 2 });
    });
    await expect.poll(() => page.evaluate(() => typeof window.__releaseStart)).toBe('function');
    await page.locator('[data-call-hangup]').click();
    await page.evaluate(async () => { __releaseStart(); await __pendingStart; });
    expect(await page.evaluate(() => __callLog.filter(([name]) => name === 'end'))).toHaveLength(1);
    expect(await page.evaluate(() => __callLog.filter(([name]) => name === 'history'))).toEqual([['history', 'chat-1']]);
});

test('hangup during connection prevents late microphone publication', async ({ page }) => {
    await installCallHarness(page);
    await page.evaluate(() => { window.__delayConnect = true; window.__pendingStart = __calls.start('audio', {id:'chat-1',accepted_count:2}); });
    await expect.poll(() => page.evaluate(() => typeof window.__resolveConnect)).toBe('function');
    await page.getByRole('button', {name:'End call',exact:true}).click();
    await page.evaluate(async () => { __resolveConnect(); await __pendingStart; });
    expect(await page.evaluate(() => __callLog.some(([name]) => name === 'microphone'))).toBe(false);
    await expect(page.locator('.call-overlay')).toBeHidden();
});

test('double initiation sends once and an ambiguous explicit retry keeps its identity', async ({ page }) => {
    await installCallHarness(page);
    const result = await page.evaluate(async () => {
        const original = __callAPI.startCall, ids = []; let fail = true;
        __callAPI.startCall = async (...args) => { ids.push(args[3]); if (fail) { fail = false; throw Object.assign(new Error('Network interrupted'), {status:0}); } return original(...args); };
        const chat = {id:'chat-1',accepted_count:2};
        await __calls.start('audio', chat);
        const failureExplained = document.querySelector('.call-overlay').open && document.querySelector('[data-call-status]').textContent === 'Could not connect' && !__calls.isActive();
        await Promise.all([__calls.start('audio', chat), __calls.start('audio', chat)]);
        return {ids, failureExplained};
    });
    expect(result.failureExplained).toBe(true); expect(result.ids).toHaveLength(2); expect(result.ids[0]).toBe(result.ids[1]);
    await page.getByRole('button', {name:'End call',exact:true}).click();
});

test('the chat header initiates one voice call and preserves compact native controls', async ({page}) => {
    await installCallHarness(page, {chatUI:true});
    await page.evaluate(async () => {
        const {DemoAPI} = await import('/app/demo-api.js');
        const start = __callAPI.startCall, end = __callAPI.endCall;
        let history;
        __callAPI.startCall = async (...args) => {
            const call = await start(...args); call.chat_id = args[1];
            history = { id: 'authoritative-call', chat_id: args[1], room_sequence: 999, kind: 'system', status: 'active',
                call_id: call.id, call_state: 'ringing', call_media_type: 'audio', viewer_is_sender: true, created_at: new Date().toISOString() };
            return call;
        };
        __callAPI.endCall = async (...args) => { const call = await end(...args); history.call_state = 'cancelled'; return { ...call, chat_id: history.chat_id, state: 'cancelled' }; };
        const messages = DemoAPI.prototype.getChatMessages;
        DemoAPI.prototype.getChatMessages = async function(...args) {
            const response = await messages.apply(this, args);
            if (history && history.chat_id === args[1]) response.items.push({ ...history });
            return response;
        };
        Object.assign(DemoAPI.prototype, __callAPI);
    });
    await page.getByRole('button', {name:/^sign in$/i}).click();
    await page.getByRole('button', {name:'Chats',exact:true}).click();
    await page.getByRole('button', {name:/Noah Williams/}).click();
    await expect(page.getByRole('button', {name:'Start voice call'})).toBeVisible();
    await expect(page.getByRole('button', {name:'Start video call'})).toHaveCount(0);
    await page.screenshot({path:test.info().outputPath('call-enabled-chat.png')});
    await page.getByRole('button', {name:'Start voice call'}).click();
    await expect(page.locator('.call-overlay[open]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => __callLog.filter(([name]) => name === 'start').length)).toBe(1);
    expect(await page.evaluate(() => __callLog.find(([name]) => name === 'start').slice(1,3))).toEqual(['chat-noah','audio']);
    await page.getByRole('button', {name:'End call',exact:true}).click();
    // No SSE event is emitted: the acknowledged end must still refresh history.
    await expect(page.locator('.chat-call-history')).toHaveCount(1);
    await expect(page.locator('.chat-call-history')).toContainText('Cancelled voice call');
});

test('available browser audio-output picker applies to remote audio without storing device identifiers', async ({page}) => {
    await installCallHarness(page);
    await page.evaluate(async () => {
        navigator.mediaDevices.selectAudioOutput = async () => ({deviceId:'headphones-fixture'});
        HTMLMediaElement.prototype.setSinkId = async function(id) { __callLog.push(['output',id]); };
        await __calls.start('audio', {id:'chat-1',accepted_count:2});
        __fakeRoom.remoteParticipants.set('user-2', {name:'Maya',trackPublications:new Map([['audio',{track:new __FakeTrack('audio')}]])});
        __fakeRoom.handlers.get('participantConnected')();
    });
    await page.getByRole('button', {name:'Audio output',exact:true}).click();
    await expect.poll(() => page.evaluate(() => __callLog.some(([name,id]) => name === 'output' && id === 'headphones-fixture'))).toBe(true);
    expect(await page.evaluate(() => JSON.stringify(localStorage).includes('headphones-fixture'))).toBe(false);
    await page.getByRole('button', {name:'End call',exact:true}).click();
});
