import { uiIcon } from '../ui-icons.js';
import { createRingback } from './ringback.js';
const TERMINAL_STATES = new Set(["ended", "declined", "missed", "cancelled", "failed"]);
const callOutcome = state => ({ declined: 'Call declined', missed: 'No answer', cancelled: 'Call cancelled', failed: 'Could not connect' }[state] || 'Call ended');

async function loadLiveKit() {
    if (typeof globalThis.__VALID_LIVEKIT_LOADER__ === "function") {
        return globalThis.__VALID_LIVEKIT_LOADER__();
    }
    return import("./livekit.bundle.js");
}

function permissionMessage(error, mediaType) {
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
        return `Allow ${mediaType === "video" ? "camera and microphone" : "microphone"} access in your browser settings, then try again.`;
    }
    if (error?.name === "NotFoundError") return "No usable microphone was found on this device.";
    return error?.message || "This device could not start the call.";
}

export function createCallsController({ api, getUser, getConfig, showToast }) {
    let currentCall = null;
    let room = null;
    let liveKit = null;
    let cameraReservationId = null;
    let cameraRequestId = null;
    let cameraEnabled = false;
    let muted = false;
    let operationInFlight = false;
    let ending = false;
    let lifecycleTimer = null;
    let generation = 0;
    let outputDeviceId = '';
    let outgoing = false;
    let ringbackFinished = false;
    let mediaReady = false;
    let reconnecting = false;
    const isCurrent = token => token === generation && !ending;
    const startRequestIds = new Map();
    const attachedMedia = new Map();

    const dialog = document.createElement("dialog");
    dialog.className = "call-overlay";
    dialog.setAttribute("aria-label", "Valid call");
    dialog.innerHTML = `
        <section class="call-card">
            <header><span class="call-kind" aria-hidden="true">${uiIcon('phone')}</span><div><strong data-call-title>Valid call</strong><small data-call-status>Connecting…</small></div></header>
            <div class="call-media-grid" data-call-media aria-live="polite"></div>
            <div class="call-incoming-actions hidden" data-call-incoming-actions>
                <button class="call-decline" type="button" data-call-decline aria-label="Decline call">${uiIcon('hangup')}</button>
                <button class="call-accept" type="button" data-call-accept aria-label="Accept call">${uiIcon('phone')}</button>
            </div>
            <div class="call-active-actions hidden" data-call-active-actions>
                <button type="button" data-call-audio aria-label="Mute" aria-pressed="false">${uiIcon('mic')}</button>
                <button type="button" data-call-output aria-label="Audio output" hidden>${uiIcon('speaker')}</button>
                <button type="button" data-call-video aria-label="Turn camera on" aria-pressed="false">${uiIcon('video-off')}</button>
                <button class="call-hangup" type="button" data-call-hangup aria-label="End call">${uiIcon('hangup')}</button>
            </div>
            <button class="call-enable-sound hidden" type="button" data-call-enable-sound>Tap to enable sound</button>
            <button class="call-enable-sound hidden" type="button" data-call-dismiss>Close</button>
            <p class="call-note">Keep Six7 open during your call.</p>
        </section>`;
    document.body.append(dialog);

    const titleNode = dialog.querySelector("[data-call-title]");
    const statusNode = dialog.querySelector("[data-call-status]");
    statusNode.setAttribute('role', 'status');
    statusNode.setAttribute('aria-live', 'polite');
    const mediaNode = dialog.querySelector("[data-call-media]");
    const incomingActions = dialog.querySelector("[data-call-incoming-actions]");
    const activeActions = dialog.querySelector("[data-call-active-actions]");
    const soundButton = dialog.querySelector("[data-call-enable-sound]");
    const dismissButton = dialog.querySelector('[data-call-dismiss]');
    const ringback = createRingback({ onBlocked: () => soundButton.classList.remove('hidden') });
    const microphoneButton = dialog.querySelector("[data-call-audio]");
    const cameraButton = dialog.querySelector("[data-call-video]");

    const enabled = () => getConfig()?.enable_calls === true && getConfig()?.enable_web_calls === true;
    const userId = () => getUser()?.id;

    function setStatus(value) {
        statusNode.textContent = value;
    }

    function scheduleLifecycleCheck(call) {
        clearTimeout(lifecycleTimer);
        lifecycleTimer = null;
        const deadline = call?.state === "active" ? call.max_ends_at : call?.ringing_expires_at;
        const deadlineTime = Date.parse(deadline || "");
        if (!Number.isFinite(deadlineTime)) return;
        lifecycleTimer = setTimeout(async () => {
            lifecycleTimer = null;
            if (!currentCall || String(currentCall.id) !== String(call.id)) return;
            const token = generation;
            try {
                const refreshed = await api.getCall(userId(), call.id);
                if (!isCurrent(token)) return;
                currentCall = refreshed;
                if (TERMINAL_STATES.has(refreshed.state)) await finish({ notifyBackend: false, outcome: callOutcome(refreshed.state) });
                else { scheduleLifecycleCheck(refreshed); renderParticipants(); }
            } catch (_) {
                if (isCurrent(token)) setStatus("Call status unavailable");
            }
        }, Math.max(5000, Math.min(12 * 60 * 60_000, deadlineTime - Date.now() + 250)));
    }

    function showDialog() {
        if (!dialog.open) dialog.showModal();
    }

    function setIncomingMode(incoming) {
        dismissButton.classList.add('hidden');
        dialog.querySelector('.call-note').hidden = false;
        incomingActions.classList.toggle("hidden", !incoming);
        activeActions.classList.toggle("hidden", incoming);
    }

    function updateControls() {
        microphoneButton.innerHTML = uiIcon(muted ? 'mic-off' : 'mic');
        microphoneButton.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
        microphoneButton.setAttribute("aria-pressed", String(muted));
        cameraButton.innerHTML = uiIcon(cameraEnabled ? 'video' : 'video-off');
        cameraButton.setAttribute('aria-label', cameraEnabled ? 'Turn camera off' : 'Turn camera on');
        cameraButton.setAttribute("aria-pressed", String(cameraEnabled));
        cameraButton.disabled = operationInFlight || !room;
        microphoneButton.disabled = operationInFlight || !room;
        incomingActions.querySelectorAll('button').forEach(button => { button.disabled = operationInFlight; });
        const output = dialog.querySelector('[data-call-output]');
        output.hidden = !(navigator.mediaDevices?.selectAudioOutput && HTMLMediaElement.prototype.setSinkId);
        output.disabled = operationInFlight || !room;
    }

    async function preflightPermissions(mediaType) {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Calling is not supported by this browser.");
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            // Camera is progressive: a video call can still connect safely as
            // audio-only when camera permission or publisher capacity is absent.
            video: false,
        });
        for (const track of stream.getTracks()) track.stop();
    }

    function clearAttachedMedia() {
        for (const [element, track] of attachedMedia) {
            try { track.detach?.(element); } catch (_) { /* The room is already closing. */ }
            element.remove();
        }
        attachedMedia.clear();
        mediaNode.replaceChildren();
    }

    function attachTrack(track, card, mutedElement = false) {
        const element = track.attach();
        element.autoplay = true;
        element.playsInline = true;
        if (mutedElement) element.muted = true;
        if (track.kind === "audio") element.className = "call-audio-track";
        else element.className = "call-video-track";
        card.append(element);
        attachedMedia.set(element, track);
        if (outputDeviceId && element.setSinkId) void element.setSinkId(outputDeviceId).catch(() => { outputDeviceId = ''; });
        element.play?.().catch(() => soundButton.classList.remove("hidden"));
    }

    function participantCard(participant, isLocal = false) {
        const card = document.createElement("article");
        card.className = "call-participant";
        const name = isLocal ? "You" : participant.name || "Student";
        const avatar = document.createElement('b'); avatar.className = 'call-participant-avatar'; avatar.textContent = name.slice(0, 1).toUpperCase(); card.append(avatar);
        const label = document.createElement("span");
        label.textContent = name;
        card.append(label);
        const publications = participant.trackPublications?.values?.() || [];
        for (const publication of publications) {
            if (publication.track) { attachTrack(publication.track, card, isLocal); if (publication.track.kind === 'video') avatar.hidden = true; }
        }
        return card;
    }

    function renderParticipants() {
        if (currentCall?.state === 'active' || room?.remoteParticipants.size > 0) ringbackFinished = true;
        if (outgoing && currentCall && mediaReady && !reconnecting && !ending && !ringbackFinished && !TERMINAL_STATES.has(currentCall.state)) ringback.play();
        else ringback.stop();
        const count = room?.remoteParticipants.size || 0;
        const connectionStatus = reconnecting ? 'Reconnecting…' : !mediaReady ? 'Connecting…' : count > 0 ? 'Connected' : currentCall?.state === 'active' ? 'Connecting audio…' : 'Waiting for an answer…';
        clearAttachedMedia();
        if (!room || (!room.remoteParticipants.size && !cameraEnabled)) {
            const card = document.createElement('div'), avatar = document.createElement('b');
            card.className = 'call-avatar'; avatar.className = 'call-participant-avatar';
            avatar.textContent = titleNode.textContent.trim().slice(0, 1).toUpperCase(); card.append(avatar); mediaNode.append(card);
            if (room || outgoing) setStatus(connectionStatus);
            return;
        }
        mediaNode.append(participantCard(room.localParticipant, true));
        for (const participant of room.remoteParticipants.values()) mediaNode.append(participantCard(participant));
        setStatus(connectionStatus);
    }

    async function enableAudioPlayback() {
        const token = generation;
        try {
            const toneReady = ringback.resume();
            // Handle rejection immediately even if the SDK takes time to resume.
            const playbackReady = Promise.all([toneReady, room?.startAudio?.()]);
            await playbackReady;
            for (const element of attachedMedia.keys()) await element.play?.();
            if (isCurrent(token)) soundButton.classList.add("hidden");
        } catch (_) {
            if (isCurrent(token) && currentCall) soundButton.classList.remove("hidden");
        }
    }

    async function chooseAudioOutput() {
        if (!room || !navigator.mediaDevices?.selectAudioOutput) return;
        const token = generation;
        try {
            const device = await navigator.mediaDevices.selectAudioOutput();
            if (!isCurrent(token)) return;
            for (const element of attachedMedia.keys()) if (element.setSinkId) await element.setSinkId(device.deviceId);
            outputDeviceId = device.deviceId;
        } catch (error) { if (error?.name !== 'NotAllowedError') showToast?.('Could not change audio output. Use your device’s audio controls.'); }
    }

    function bindRoomEvents() {
        const token = generation;
        const rerender = () => { if (isCurrent(token)) renderParticipants(); };
        room.on(liveKit.RoomEvent.TrackSubscribed, rerender);
        room.on(liveKit.RoomEvent.TrackUnsubscribed, rerender);
        room.on(liveKit.RoomEvent.TrackMuted, rerender);
        room.on(liveKit.RoomEvent.TrackUnmuted, rerender);
        room.on(liveKit.RoomEvent.LocalTrackPublished, rerender);
        room.on(liveKit.RoomEvent.LocalTrackUnpublished, rerender);
        room.on(liveKit.RoomEvent.ParticipantConnected, rerender);
        room.on(liveKit.RoomEvent.ParticipantDisconnected, rerender);
        room.on(liveKit.RoomEvent.Reconnecting, () => { if (isCurrent(token)) { reconnecting = true; renderParticipants(); } });
        room.on(liveKit.RoomEvent.Reconnected, () => { if (isCurrent(token)) { reconnecting = false; renderParticipants(); } });
        room.on(liveKit.RoomEvent.Disconnected, () => {
            if (isCurrent(token) && currentCall && !TERMINAL_STATES.has(currentCall.state)) void finish({ notifyBackend: true, outcome: 'Call disconnected' });
        });
    }

    async function connectToCall(call, token) {
        liveKit ||= await loadLiveKit();
        if (!isCurrent(token)) return;
        const credentials = await api.joinCall(userId(), call.id);
        if (!isCurrent(token)) return;
        currentCall = credentials.call;
        scheduleLifecycleCheck(currentCall);
        cameraReservationId = credentials.camera_slot_reservation_id || null;
        room = new liveKit.Room({ adaptiveStream: true, dynacast: true });
        const connectingRoom = room;
        bindRoomEvents();
        await room.connect(credentials.server_url, credentials.access_token, { autoSubscribe: true });
        if (!isCurrent(token)) { await connectingRoom.disconnect(); return; }
        await room.localParticipant.setMicrophoneEnabled(true);
        if (!isCurrent(token)) { await connectingRoom.disconnect(); return; }
        muted = false;
        mediaReady = true;
        outputDeviceId = '';
        if (currentCall.media_type === "video") await setCamera(true, { insideOperation: true });
        if (!isCurrent(token)) { await connectingRoom.disconnect(); return; }
        updateControls();
        renderParticipants();
        void enableAudioPlayback();
    }

    async function start(mediaType, chat) {
        if (!enabled()) return showToast?.("Calls are not available in this web release.");
        if (currentCall || operationInFlight || ending) return showToast?.("You’re already in a call.");
        if (Number(chat?.accepted_count || 0) < 2 || chat?.has_viewer_blocked_member === true) {
            return showToast?.("This chat isn’t available for calls.");
        }
        operationInFlight = true;
        outgoing = true; ringbackFinished = false; mediaReady = false; reconnecting = false; ringback.prepare();
        const token = ++generation, callerId = userId();
        titleNode.textContent = chat.display_name || 'Call';
        setStatus('Connecting…'); setIncomingMode(false); renderParticipants(); showDialog(); updateControls();
        const key = `${chat.id}:${mediaType}`;
        const requestId = startRequestIds.get(key) || crypto.randomUUID();
        startRequestIds.set(key, requestId);
        if (startRequestIds.size > 32) startRequestIds.delete(startRequestIds.keys().next().value);
        try {
            await preflightPermissions(mediaType);
            if (!isCurrent(token)) return;
            const call = await api.startCall(callerId, chat.id, mediaType, requestId);
            if (!isCurrent(token)) { await api.endCall(callerId, call.id, { keepalive: true }); return; }
            startRequestIds.delete(key);
            currentCall = call;
            scheduleLifecycleCheck(call);
            titleNode.textContent = chat.display_name || call.caller_name || "Valid call";
            setStatus("Calling…");
            setIncomingMode(false);
            showDialog();
            renderParticipants();
            await connectToCall(call, token);
        } catch (error) {
            if (!isCurrent(token)) return;
            if (error?.status && error.status !== 408 && error.status < 500) startRequestIds.delete(key);
            await finish({ notifyBackend: true, outcome: 'Could not connect' });
            showToast?.(permissionMessage(error, mediaType));
        } finally {
            if (isCurrent(token)) { operationInFlight = false; updateControls(); }
        }
    }

    function presentIncoming(call) {
        if (!enabled() || currentCall || operationInFlight || TERMINAL_STATES.has(call.state)) return;
        generation++;
        currentCall = call;
        scheduleLifecycleCheck(call);
        titleNode.textContent = call.caller_name || "Incoming call";
        setStatus(`Incoming ${call.media_type === "video" ? "video" : "voice"} call`);
        setIncomingMode(true);
        renderParticipants();
        showDialog();
    }

    async function open(callId) {
        if (!enabled() || !callId || currentCall || operationInFlight || ending) return;
        const token = ++generation;
        operationInFlight = true;
        try {
            const call = await api.getCall(userId(), callId);
            if (!isCurrent(token)) return;
            if (TERMINAL_STATES.has(call.state)) return showToast?.("That call has ended.");
            scheduleLifecycleCheck(call);
            if (call.viewer_invitation_state === "accepted") {
                outgoing = String(call.initiated_by_user_id) === String(userId());
                ringbackFinished = call.state === 'active';
                if (outgoing) ringback.prepare();
                currentCall = call;
                titleNode.textContent = call.caller_name || "Valid call";
                setIncomingMode(false);
                showDialog();
                await preflightPermissions(call.media_type);
                if (!isCurrent(token)) return;
                await connectToCall(call, token);
            } else { operationInFlight = false; presentIncoming(call); }
        } catch (error) {
            if (!isCurrent(token)) return;
            if (currentCall) await finish({ notifyBackend: true });
            showToast?.(error.message || "That call is no longer available.");
        } finally { if (isCurrent(token)) { operationInFlight = false; updateControls(); } }
    }

    async function accept() {
        if (!currentCall || operationInFlight) return;
        operationInFlight = true;
        const token = generation, call = currentCall;
        updateControls();
        try {
            await preflightPermissions(call.media_type);
            if (!isCurrent(token)) return;
            const accepted = await api.acceptCall(userId(), call.id);
            if (!isCurrent(token)) return;
            currentCall = accepted;
            setIncomingMode(false);
            setStatus("Connecting…");
            await connectToCall(currentCall, token);
        } catch (error) {
            if (!isCurrent(token)) return;
            showToast?.(permissionMessage(error, currentCall?.media_type || "audio"));
            if (currentCall?.state === "active") await finish({ notifyBackend: true });
            else if ([404, 410].includes(error?.status)) await finish({ notifyBackend: false });
        } finally {
            if (isCurrent(token)) { operationInFlight = false; updateControls(); }
        }
    }

    async function decline() {
        if (!currentCall || operationInFlight) return;
        const token = generation;
        operationInFlight = true;
        let declined = false;
        try {
            await api.declineCall(userId(), currentCall.id);
            declined = true;
        }
        catch (error) { showToast?.(error.message || "Could not decline the call."); }
        finally {
            if (isCurrent(token)) {
                operationInFlight = false;
                if (declined) await finish({ notifyBackend: false });
                else updateControls();
            }
        }
    }

    async function setCamera(enabledValue, { quiet = false, insideOperation = false } = {}) {
        if (!room || !currentCall || (operationInFlight && !insideOperation)) return;
        const token = generation, callId = currentCall.id, cameraRoom = room, callerId = userId();
        const ownsOperation = !operationInFlight;
        if (ownsOperation) operationInFlight = true;
        try {
            if (enabledValue) {
                cameraRequestId ||= crypto.randomUUID();
                const slot = await api.enableCallCamera(callerId, callId, cameraRequestId);
                if (!isCurrent(token)) {
                    if (slot.camera_slot_reservation_id) await api.disableCallCamera(callerId, callId, slot.camera_slot_reservation_id).catch(() => {});
                    return;
                }
                if (!slot.camera_slot_reserved || !slot.camera_slot_reservation_id) throw new Error("Video is full. Try again when someone turns off their camera.");
                cameraReservationId = slot.camera_slot_reservation_id;
                await room.localParticipant.setCameraEnabled(true, { facingMode: "user" });
                if (!isCurrent(token)) { await cameraRoom.localParticipant.setCameraEnabled(false); return; }
                cameraEnabled = true;
                cameraRequestId = null;
            } else {
                await room.localParticipant.setCameraEnabled(false);
                if (!isCurrent(token)) return;
                cameraEnabled = false;
                if (cameraReservationId) {
                    const reservationId = cameraReservationId;
                    await api.disableCallCamera(userId(), currentCall.id, reservationId);
                    cameraReservationId = null;
                }
            }
            renderParticipants();
        } catch (error) {
            if (!isCurrent(token)) return;
            if (enabledValue && cameraReservationId) {
                await api.disableCallCamera(userId(), currentCall.id, cameraReservationId).catch(() => null);
                cameraReservationId = null;
            }
            cameraEnabled = false;
            if (!quiet) showToast?.(permissionMessage(error, "video"));
        } finally {
            if (isCurrent(token)) { if (ownsOperation) operationInFlight = false; updateControls(); }
        }
    }

    async function toggleMute() {
        if (!room || operationInFlight) return;
        const token = generation;
        operationInFlight = true;
        try {
            await room.localParticipant.setMicrophoneEnabled(muted);
            if (!isCurrent(token)) return;
            muted = !muted;
        } catch (error) { showToast?.(error.message || "Could not change the microphone."); }
        finally { if (isCurrent(token)) { operationInFlight = false; updateControls(); } }
    }

    async function finish({ notifyBackend = true, keepalive = false, outcome = null } = {}) {
        const call = currentCall;
        if (ending) return;
        generation++;
        ending = true;
        ringback.dispose(); outgoing = false; ringbackFinished = false;
        mediaReady = false; reconnecting = false;
        soundButton.classList.add('hidden');
        currentCall = null;
        clearTimeout(lifecycleTimer);
        lifecycleTimer = null;
        clearAttachedMedia();
        try { await room?.disconnect(); } catch (_) { /* Provider cleanup is best effort. */ }
        room = null;
        if (call && notifyBackend && userId()) {
            const method = call.state === "active" ? "leaveCall" : "endCall";
            let lastError = null;
            const attempts = keepalive ? 1 : 3;
            for (let attempt = 0; attempt < attempts; attempt += 1) {
                try {
                    await api[method](userId(), call.id, { keepalive });
                    lastError = null;
                    break;
                } catch (error) {
                    lastError = error;
                    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
                }
            }
            if (lastError && !keepalive) showToast?.(lastError.message || "The server could not confirm that you left.");
        }
        currentCall = null;
        cameraReservationId = null;
        cameraRequestId = null;
        cameraEnabled = false;
        muted = false;
        outputDeviceId = '';
        operationInFlight = false;
        if (outcome) {
            renderParticipants(); setStatus(outcome);
            incomingActions.classList.add('hidden'); activeActions.classList.add('hidden');
            dismissButton.classList.remove('hidden'); showDialog();
            dialog.querySelector('.call-note').hidden = true;
        } else if (dialog.open) dialog.close();
        ending = false;
        updateControls();
    }

    async function handleRealtimeEvent(event) {
        if (!enabled() || !String(event?.type || "").startsWith("call_")) return;
        const callId = event.call_id;
        if (!callId) return;
        if (!currentCall && (event.type !== "call_started" || operationInFlight)) return;
        if (currentCall && String(currentCall.id) !== String(callId)) return;
        const token = generation;
        try {
            const call = await api.getCall(userId(), callId);
            if (!isCurrent(token)) return;
            if (!currentCall && event.type === "call_started" && String(event.actor_user_id) !== String(userId())) return presentIncoming(call);
            currentCall = call;
            scheduleLifecycleCheck(call);
            if (TERMINAL_STATES.has(call.state)) return finish({ notifyBackend: false, outcome: callOutcome(call.state) });
            renderParticipants();
        } catch (_) {
            if (isCurrent(token) && currentCall) setStatus('Reconnecting…');
        }
    }

    dialog.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        if (button.matches('[data-call-dismiss]')) { dialog.close(); return; }
        void enableAudioPlayback();
        if (button.matches("[data-call-accept]")) void accept();
        if (button.matches("[data-call-decline]")) void decline();
        if (button.matches("[data-call-hangup]")) void finish();
        if (button.matches("[data-call-audio]")) void toggleMute();
        if (button.matches("[data-call-video]")) void setCamera(!cameraEnabled);
        if (button.matches('[data-call-output]')) void chooseAudioOutput();
        if (button.matches("[data-call-enable-sound]")) void enableAudioPlayback();
    });
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        if (currentCall?.viewer_invitation_state === "invited") void decline();
        else void finish();
    });
    window.addEventListener("pagehide", (event) => {
        if (currentCall || operationInFlight) void finish({ notifyBackend: true, keepalive: true });
    });
    window.addEventListener("valid:session-expired", () => {
        if (currentCall || operationInFlight) void finish({ notifyBackend: false });
    });

    return { enabled, start, open, handleRealtimeEvent, isActive: () => Boolean(currentCall || operationInFlight || ending), beforeSessionEnd: () => finish({ notifyBackend: true }) };
}
