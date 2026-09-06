const TERMINAL_STATES = new Set(["ended", "declined", "missed", "cancelled", "failed"]);

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
    const startRequestIds = new Map();
    const attachedMedia = new Map();

    const dialog = document.createElement("dialog");
    dialog.className = "call-overlay";
    dialog.setAttribute("aria-label", "Valid call");
    dialog.innerHTML = `
        <section class="call-card">
            <header><span class="call-kind" aria-hidden="true">☎</span><div><strong data-call-title>Valid call</strong><small data-call-status>Connecting…</small></div></header>
            <div class="call-media-grid" data-call-media aria-live="polite"></div>
            <div class="call-incoming-actions hidden" data-call-incoming-actions>
                <button class="call-decline" type="button" data-call-decline>Decline</button>
                <button class="call-accept" type="button" data-call-accept>Accept</button>
            </div>
            <div class="call-active-actions hidden" data-call-active-actions>
                <button type="button" data-call-audio aria-pressed="true">Mic on</button>
                <button type="button" data-call-video aria-pressed="false">Camera off</button>
                <button class="call-hangup" type="button" data-call-hangup>End</button>
            </div>
            <button class="call-enable-sound hidden" type="button" data-call-enable-sound>Tap to enable sound</button>
            <p class="call-note">Calls stay connected only while this web app can run. For reliable lock-screen incoming calls, use the iPhone app.</p>
        </section>`;
    document.body.append(dialog);

    const titleNode = dialog.querySelector("[data-call-title]");
    const statusNode = dialog.querySelector("[data-call-status]");
    const mediaNode = dialog.querySelector("[data-call-media]");
    const incomingActions = dialog.querySelector("[data-call-incoming-actions]");
    const activeActions = dialog.querySelector("[data-call-active-actions]");
    const soundButton = dialog.querySelector("[data-call-enable-sound]");
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
            try {
                const refreshed = await api.getCall(userId(), call.id);
                currentCall = refreshed;
                if (TERMINAL_STATES.has(refreshed.state)) await finish({ notifyBackend: false });
                else scheduleLifecycleCheck(refreshed);
            } catch (_) {
                setStatus("Call status unavailable");
            }
        }, Math.max(0, Math.min(12 * 60 * 60_000, deadlineTime - Date.now() + 250)));
    }

    function showDialog() {
        if (!dialog.open) dialog.showModal();
    }

    function setIncomingMode(incoming) {
        incomingActions.classList.toggle("hidden", !incoming);
        activeActions.classList.toggle("hidden", incoming);
    }

    function updateControls() {
        microphoneButton.textContent = muted ? "Mic off" : "Mic on";
        microphoneButton.setAttribute("aria-pressed", String(!muted));
        cameraButton.textContent = cameraEnabled ? "Camera on" : "Camera off";
        cameraButton.setAttribute("aria-pressed", String(cameraEnabled));
        cameraButton.disabled = operationInFlight;
        microphoneButton.disabled = operationInFlight;
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
        element.play?.().catch(() => soundButton.classList.remove("hidden"));
    }

    function participantCard(participant, isLocal = false) {
        const card = document.createElement("article");
        card.className = "call-participant";
        const name = isLocal ? "You" : participant.name || "Student";
        const label = document.createElement("span");
        label.textContent = name;
        card.append(label);
        const publications = participant.trackPublications?.values?.() || [];
        for (const publication of publications) {
            if (publication.track) attachTrack(publication.track, card, isLocal);
        }
        return card;
    }

    function renderParticipants() {
        clearAttachedMedia();
        if (!room) {
            mediaNode.innerHTML = `<div class="call-avatar" aria-hidden="true">${currentCall?.media_type === "video" ? "▣" : "☎"}</div>`;
            return;
        }
        mediaNode.append(participantCard(room.localParticipant, true));
        for (const participant of room.remoteParticipants.values()) mediaNode.append(participantCard(participant));
        const count = room.remoteParticipants.size;
        setStatus(count > 0 ? `Connected · ${count + 1} people` : (currentCall?.state === "active" ? "Waiting for others…" : "Calling…"));
    }

    async function enableAudioPlayback() {
        try {
            await room?.startAudio?.();
            for (const element of attachedMedia.keys()) await element.play?.();
            soundButton.classList.add("hidden");
        } catch (_) {
            soundButton.classList.remove("hidden");
        }
    }

    function bindRoomEvents() {
        const rerender = () => renderParticipants();
        room.on(liveKit.RoomEvent.TrackSubscribed, rerender);
        room.on(liveKit.RoomEvent.TrackUnsubscribed, rerender);
        room.on(liveKit.RoomEvent.TrackMuted, rerender);
        room.on(liveKit.RoomEvent.TrackUnmuted, rerender);
        room.on(liveKit.RoomEvent.LocalTrackPublished, rerender);
        room.on(liveKit.RoomEvent.LocalTrackUnpublished, rerender);
        room.on(liveKit.RoomEvent.ParticipantConnected, rerender);
        room.on(liveKit.RoomEvent.ParticipantDisconnected, rerender);
        room.on(liveKit.RoomEvent.Reconnecting, () => setStatus("Reconnecting…"));
        room.on(liveKit.RoomEvent.Reconnected, rerender);
        room.on(liveKit.RoomEvent.Disconnected, () => {
            if (!ending && currentCall && !TERMINAL_STATES.has(currentCall.state)) setStatus("Call disconnected");
        });
    }

    async function connectToCall(call) {
        liveKit ||= await loadLiveKit();
        const credentials = await api.joinCall(userId(), call.id);
        currentCall = credentials.call;
        scheduleLifecycleCheck(currentCall);
        cameraReservationId = credentials.camera_slot_reservation_id || null;
        room = new liveKit.Room({ adaptiveStream: true, dynacast: true });
        bindRoomEvents();
        await room.connect(credentials.server_url, credentials.access_token, { autoSubscribe: true });
        await room.localParticipant.setMicrophoneEnabled(true);
        muted = false;
        if (currentCall.media_type === "video") await setCamera(true, { insideOperation: true });
        updateControls();
        renderParticipants();
        void enableAudioPlayback();
    }

    async function start(mediaType, chat) {
        if (!enabled()) return showToast?.("Calls are not available in this web release.");
        if (currentCall || operationInFlight) return showToast?.("You’re already in a call.");
        if (Number(chat?.accepted_count || 0) < 2 || chat?.has_viewer_blocked_member === true) {
            return showToast?.("This chat isn’t available for calls.");
        }
        operationInFlight = true;
        const key = `${chat.id}:${mediaType}`;
        const requestId = startRequestIds.get(key) || crypto.randomUUID();
        startRequestIds.set(key, requestId);
        try {
            await preflightPermissions(mediaType);
            const call = await api.startCall(userId(), chat.id, mediaType, requestId);
            startRequestIds.delete(key);
            currentCall = call;
            scheduleLifecycleCheck(call);
            titleNode.textContent = chat.display_name || call.caller_name || "Valid call";
            setStatus("Calling…");
            setIncomingMode(false);
            showDialog();
            renderParticipants();
            await connectToCall(call);
        } catch (error) {
            if (![0, 408].includes(error?.status)) startRequestIds.delete(key);
            if (currentCall) await finish({ notifyBackend: true });
            showToast?.(permissionMessage(error, mediaType));
        } finally {
            operationInFlight = false;
            updateControls();
        }
    }

    function presentIncoming(call) {
        if (!enabled() || currentCall || TERMINAL_STATES.has(call.state)) return;
        currentCall = call;
        scheduleLifecycleCheck(call);
        titleNode.textContent = call.caller_name || "Incoming call";
        setStatus(`Incoming ${call.media_type === "video" ? "video" : "voice"} call`);
        setIncomingMode(true);
        renderParticipants();
        showDialog();
    }

    async function open(callId) {
        if (!enabled() || !callId || currentCall) return;
        try {
            const call = await api.getCall(userId(), callId);
            if (TERMINAL_STATES.has(call.state)) return showToast?.("That call has ended.");
            scheduleLifecycleCheck(call);
            if (call.viewer_invitation_state === "accepted") {
                currentCall = call;
                titleNode.textContent = call.caller_name || "Valid call";
                setIncomingMode(false);
                showDialog();
                await preflightPermissions(call.media_type);
                await connectToCall(call);
            } else presentIncoming(call);
        } catch (error) {
            if (currentCall) await finish({ notifyBackend: true });
            showToast?.(error.message || "That call is no longer available.");
        }
    }

    async function accept() {
        if (!currentCall || operationInFlight) return;
        operationInFlight = true;
        try {
            await preflightPermissions(currentCall.media_type);
            currentCall = await api.acceptCall(userId(), currentCall.id);
            setIncomingMode(false);
            setStatus("Connecting…");
            await connectToCall(currentCall);
        } catch (error) {
            showToast?.(permissionMessage(error, currentCall?.media_type || "audio"));
            if (currentCall?.state === "active") await finish({ notifyBackend: true });
            else if ([404, 410].includes(error?.status)) await finish({ notifyBackend: false });
        } finally {
            operationInFlight = false;
            updateControls();
        }
    }

    async function decline() {
        if (!currentCall || operationInFlight) return;
        operationInFlight = true;
        let declined = false;
        try {
            await api.declineCall(userId(), currentCall.id);
            declined = true;
        }
        catch (error) { showToast?.(error.message || "Could not decline the call."); }
        finally {
            operationInFlight = false;
            if (declined) await finish({ notifyBackend: false });
            else updateControls();
        }
    }

    async function setCamera(enabledValue, { quiet = false, insideOperation = false } = {}) {
        if (!room || !currentCall || (operationInFlight && !insideOperation)) return;
        const ownsOperation = !operationInFlight;
        if (ownsOperation) operationInFlight = true;
        try {
            if (enabledValue) {
                cameraRequestId ||= crypto.randomUUID();
                const slot = await api.enableCallCamera(userId(), currentCall.id, cameraRequestId);
                if (!slot.camera_slot_reserved || !slot.camera_slot_reservation_id) throw new Error("Video is full. Try again when someone turns off their camera.");
                cameraReservationId = slot.camera_slot_reservation_id;
                await room.localParticipant.setCameraEnabled(true, { facingMode: "user" });
                cameraEnabled = true;
                cameraRequestId = null;
            } else {
                await room.localParticipant.setCameraEnabled(false);
                cameraEnabled = false;
                if (cameraReservationId) {
                    const reservationId = cameraReservationId;
                    await api.disableCallCamera(userId(), currentCall.id, reservationId);
                    cameraReservationId = null;
                }
            }
            renderParticipants();
        } catch (error) {
            if (enabledValue && cameraReservationId) {
                await api.disableCallCamera(userId(), currentCall.id, cameraReservationId).catch(() => null);
                cameraReservationId = null;
            }
            cameraEnabled = false;
            if (!quiet) showToast?.(permissionMessage(error, "video"));
        } finally {
            if (ownsOperation) operationInFlight = false;
            updateControls();
        }
    }

    async function toggleMute() {
        if (!room || operationInFlight) return;
        operationInFlight = true;
        try {
            await room.localParticipant.setMicrophoneEnabled(muted);
            muted = !muted;
        } catch (error) { showToast?.(error.message || "Could not change the microphone."); }
        finally { operationInFlight = false; updateControls(); }
    }

    async function finish({ notifyBackend = true, keepalive = false } = {}) {
        const call = currentCall;
        if (!call || ending) return;
        ending = true;
        clearTimeout(lifecycleTimer);
        lifecycleTimer = null;
        clearAttachedMedia();
        try { await room?.disconnect(); } catch (_) { /* Provider cleanup is best effort. */ }
        room = null;
        if (notifyBackend && userId()) {
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
        operationInFlight = false;
        if (dialog.open) dialog.close();
        ending = false;
        updateControls();
    }

    async function handleRealtimeEvent(event) {
        if (!enabled() || !String(event?.type || "").startsWith("call_")) return;
        const callId = event.call_id;
        if (!callId) return;
        if (!currentCall && event.type !== "call_started") return;
        if (currentCall && String(currentCall.id) !== String(callId)) return;
        try {
            const call = await api.getCall(userId(), callId);
            if (!currentCall && event.type === "call_started" && String(event.actor_user_id) !== String(userId())) return presentIncoming(call);
            currentCall = call;
            scheduleLifecycleCheck(call);
            if (TERMINAL_STATES.has(call.state)) return finish({ notifyBackend: false });
            renderParticipants();
        } catch (_) {
            if (currentCall) await finish({ notifyBackend: false });
        }
    }

    dialog.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        void enableAudioPlayback();
        if (button.matches("[data-call-accept]")) void accept();
        if (button.matches("[data-call-decline]")) void decline();
        if (button.matches("[data-call-hangup]")) void finish();
        if (button.matches("[data-call-audio]")) void toggleMute();
        if (button.matches("[data-call-video]")) void setCamera(!cameraEnabled);
        if (button.matches("[data-call-enable-sound]")) void enableAudioPlayback();
    });
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        if (currentCall?.viewer_invitation_state === "invited") void decline();
        else void finish();
    });
    window.addEventListener("pagehide", (event) => {
        if (!event.persisted && currentCall) void finish({ notifyBackend: true, keepalive: true });
    });
    window.addEventListener("valid:session-expired", () => {
        if (currentCall) void finish({ notifyBackend: false });
    });

    return { enabled, start, open, handleRealtimeEvent, beforeSessionEnd: () => finish({ notifyBackend: true }) };
}
