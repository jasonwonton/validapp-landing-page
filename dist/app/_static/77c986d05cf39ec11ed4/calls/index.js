import { uiIcon } from '../ui-icons.js';
import { userMessage } from '../user-message.js';
import { confirmSheet } from '../ui-dialogs.js';
import { createRingback, createRingtone } from './ringback.js';
import { reportCallStartBlocked } from './start-blocked.js';
import { AUDIO_SAMPLE_INTERVAL_MS, CallAudioHealth, readIncomingAudioStats, readOutgoingAudioStats } from './audio-health.js';
import { sendCallQualitySummary } from './call-diagnostics.js';
const TERMINAL_STATES = new Set(["ended", "declined", "missed", "cancelled", "failed"]);
const callOutcome = state => ({ declined: 'Call declined', missed: 'No answer', cancelled: 'Call cancelled', failed: 'Could not connect' }[state] || 'Call ended');

async function loadLiveKit() {
    if (typeof globalThis.__VALID_LIVEKIT_LOADER__ === "function") {
        return globalThis.__VALID_LIVEKIT_LOADER__();
    }
    return import("./livekit.bundle.js");
}

// A permission prompt the browser never answers (hidden, quieted, or behind
// another window) would otherwise leave "Connecting…" up with nothing sent.
export const MICROPHONE_CHECK_TIMEOUT_MS = 30000;

function permissionMessage(error, mediaType) {
    if (error?.name === "MicrophoneTimeoutError") {
        return "Your browser didn’t answer the microphone request. Allow the microphone for Valid in your browser settings, then try again.";
    }
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
        return `Allow ${mediaType === "video" ? "camera and microphone" : "microphone"} access in your browser settings, then try again.`;
    }
    if (error?.name === "NotFoundError") return "No usable microphone was found on this device.";
    return userMessage(error, "This device could not start the call.");
}

export function createCallsController({ api, getUser, getConfig, showToast, onCallChanged }) {
    // History refresh is independent of media cleanup and cannot fail a call.
    function notifyHistory(call) {
        if (call?.chat_id) void Promise.resolve().then(() => onCallChanged?.(call)).catch(() => {});
    }
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
    let facingMode = 'user';
    let cameraPausedForBackground = false;
    let wakeLock = null, wantWakeLock = false;
    let leavePromptOpen = false;
    let minimized = false;
    let vibrationTimer = null;
    // In-call audio checks (audio-health.js): sampled while connected.
    let audioHealth = null, audioTimer = null, audioSampling = false, audioCall = null;
    let soundBlocked = false, micSilent = false, audioWarning = null;
    const isCurrent = token => token === generation && !ending;
    const startRequestIds = new Map();
    const attachedMedia = new Map();
    // Participant tiles are keyed and diffed, never rebuilt, so media keeps
    // playing and "Tap to enable sound" does not reappear on every event.
    const tiles = new Map();
    let placeholderTile = null;

    const dialog = document.createElement("dialog");
    dialog.className = "call-overlay";
    dialog.setAttribute("aria-label", "Valid call");
    dialog.innerHTML = `
        <section class="call-card">
            <header><span class="call-kind" aria-hidden="true">${uiIcon('phone')}</span><button class="call-minimize" type="button" data-call-minimize aria-label="Minimize call" hidden>${uiIcon('down')}</button><div><strong data-call-title>Valid call</strong><small data-call-status>Connecting…</small></div></header>
            <div class="call-media-grid" data-call-media aria-live="polite"></div>
            <div class="call-incoming-actions hidden" data-call-incoming-actions>
                <button class="call-decline" type="button" data-call-decline aria-label="Decline call">${uiIcon('hangup')}</button>
                <button class="call-accept" type="button" data-call-accept aria-label="Accept call">${uiIcon('phone')}</button>
            </div>
            <div class="call-active-actions hidden" data-call-active-actions>
                <button type="button" data-call-audio aria-label="Mute" aria-pressed="false">${uiIcon('mic')}</button>
                <button type="button" data-call-output aria-label="Audio output" hidden>${uiIcon('speaker')}</button>
                <button type="button" data-call-video aria-label="Turn camera on" aria-pressed="false">${uiIcon('video-off')}</button>
                <button type="button" data-call-flip aria-label="Switch camera" hidden>${uiIcon('flip')}</button>
                <button class="call-hangup" type="button" data-call-hangup aria-label="End call">${uiIcon('hangup')}</button>
            </div>
            <div class="call-audio-warning" role="alert" data-call-audio-warning hidden>
                <p data-call-audio-warning-text></p>
                <button class="call-enable-sound hidden" type="button" data-call-enable-sound>Tap to enable sound</button>
                <button class="call-enable-sound hidden" type="button" data-call-restart-mic>Restart mic</button>
            </div>
            <button class="call-enable-sound hidden" type="button" data-call-dismiss>Close</button>
            <p class="call-note">Keep Valid open during your call.</p>
        </section>`;
    document.body.append(dialog);

    // iOS CompactAudioCallBar: the call keeps going while the app is used.
    const compactBar = document.createElement('div');
    compactBar.className = 'call-compact-bar';
    compactBar.hidden = true;
    compactBar.setAttribute('role', 'region');
    compactBar.setAttribute('aria-label', 'Ongoing call');
    compactBar.innerHTML = `<button type="button" class="call-compact-return" data-call-restore><b class="call-participant-avatar" aria-hidden="true"></b><span><strong data-call-compact-title></strong><small data-call-compact-status></small></span>${uiIcon('down')}</button><button type="button" class="call-compact-mute" data-call-compact-mute aria-label="Mute">${uiIcon('mic')}</button><button type="button" class="call-compact-end" data-call-compact-end aria-label="End call">${uiIcon('hangup')}</button>`;
    document.body.append(compactBar);

    const titleNode = dialog.querySelector("[data-call-title]");
    const statusNode = dialog.querySelector("[data-call-status]");
    statusNode.setAttribute('role', 'status');
    statusNode.setAttribute('aria-live', 'polite');
    const mediaNode = dialog.querySelector("[data-call-media]");
    const incomingActions = dialog.querySelector("[data-call-incoming-actions]");
    const activeActions = dialog.querySelector("[data-call-active-actions]");
    const soundButton = dialog.querySelector("[data-call-enable-sound]");
    const dismissButton = dialog.querySelector('[data-call-dismiss]');
    const audioWarningNode = dialog.querySelector('[data-call-audio-warning]');
    const audioWarningText = dialog.querySelector('[data-call-audio-warning-text]');
    const restartMicButton = dialog.querySelector('[data-call-restart-mic]');
    const ringback = createRingback({ onBlocked: () => setSoundBlocked(true) });
    const microphoneButton = dialog.querySelector("[data-call-audio]");
    const cameraButton = dialog.querySelector("[data-call-video]");
    const flipButton = dialog.querySelector("[data-call-flip]");
    const minimizeButton = dialog.querySelector("[data-call-minimize]");
    const ringtone = createRingtone();

    const enabled = () => getConfig()?.enable_calls === true && getConfig()?.enable_web_calls === true;
    const userId = () => getUser()?.id;

    function setStatus(value) {
        statusNode.textContent = value;
        compactBar.querySelector('[data-call-compact-status]').textContent = value;
    }

    async function acquireWakeLock() {
        wantWakeLock = true;
        if (wakeLock || document.hidden || !navigator.wakeLock?.request) return;
        try {
            const lock = await navigator.wakeLock.request('screen');
            if (!wantWakeLock) { void lock.release?.().catch(() => {}); return; }
            wakeLock = lock;
            lock.addEventListener?.('release', () => { if (wakeLock === lock) wakeLock = null; });
        } catch (_) { /* Battery saver or an unsupported browser: the call still works. */ }
    }

    function releaseWakeLock() {
        wantWakeLock = false;
        const lock = wakeLock;
        wakeLock = null;
        void lock?.release?.().catch(() => {});
    }

    // Incoming ring: always visual; a tone and Android vibration when the browser allows.
    function startIncomingAlert() {
        dialog.classList.add('is-ringing');
        ringtone.play();
        const vibrate = () => { try { navigator.vibrate?.([450, 250, 450]); } catch (_) { /* Needs a prior tap. */ } };
        vibrate();
        clearInterval(vibrationTimer);
        vibrationTimer = setInterval(vibrate, 2600);
    }

    function stopIncomingAlert() {
        dialog.classList.remove('is-ringing');
        ringtone.stop();
        clearInterval(vibrationTimer);
        vibrationTimer = null;
        try { navigator.vibrate?.(0); } catch (_) { /* Nothing to cancel. */ }
    }

    function showCompactBar() {
        if (!currentCall || currentCall.viewer_invitation_state === 'invited') return;
        minimized = true;
        const title = titleNode.textContent.trim();
        compactBar.querySelector('[data-call-compact-title]').textContent = title;
        compactBar.querySelector('.call-participant-avatar').textContent = title.slice(0, 1).toUpperCase();
        compactBar.querySelector('[data-call-compact-status]').textContent = statusNode.textContent;
        compactBar.querySelector('[data-call-restore]').setAttribute('aria-label', `Return to call with ${title}`);
        compactBar.hidden = false;
        document.body.classList.add('call-minimized');
        if (dialog.open) dialog.close();
    }

    function hideCompactBar() {
        minimized = false;
        compactBar.hidden = true;
        document.body.classList.remove('call-minimized');
    }

    function restoreCall() {
        hideCompactBar();
        showDialog();
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
            if (currentCall.state !== 'active') {
                // Stop local waiting audio at the authoritative deadline even
                // when the status request hangs or the network disappears.
                ringbackFinished = true; ringback.stop();
                setStatus('Checking call status…');
            }
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
        if (minimized) return;
        if (!dialog.open) dialog.showModal();
    }

    function setIncomingMode(incoming) {
        dismissButton.classList.add('hidden');
        dialog.querySelector('.call-note').hidden = false;
        incomingActions.classList.toggle("hidden", !incoming);
        activeActions.classList.toggle("hidden", incoming);
        minimizeButton.hidden = incoming;
        if (!incoming) stopIncomingAlert();
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
        flipButton.hidden = !cameraEnabled;
        flipButton.disabled = operationInFlight || !room;
        restartMicButton.disabled = operationInFlight || !room;
        renderAudioWarning();
        const compactMute = compactBar.querySelector('[data-call-compact-mute]');
        compactMute.innerHTML = uiIcon(muted ? 'mic-off' : 'mic');
        compactMute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
        compactMute.disabled = operationInFlight || !room;
    }

    // Every way this fails is before the server hears of the call, so each one
    // reports call.start_blocked (start-blocked.js).
    async function preflightPermissions(mediaType, { chatId = null, direction = 'outgoing' } = {}) {
        const blocked = (reason, error) => {
            reportCallStartBlocked(reason, { chatId, mediaType, direction, errorName: error?.name });
            return error;
        };
        if (!navigator.mediaDevices?.getUserMedia) {
            throw blocked('unsupported_browser', Object.assign(new Error("Calling is not supported by this browser."), { name: 'NotSupportedError' }));
        }
        let timer;
        const request = navigator.mediaDevices.getUserMedia({
            audio: true,
            // Camera is progressive: a video call can still connect safely as
            // audio-only when camera permission or publisher capacity is absent.
            video: false,
        });
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(
                new Error("Your browser didn’t answer the microphone request."), { name: 'MicrophoneTimeoutError' },
            )), globalThis.__VALID_MICROPHONE_CHECK_TIMEOUT_MS__ ?? MICROPHONE_CHECK_TIMEOUT_MS);
        });
        try {
            const stream = await Promise.race([request, timeout]);
            for (const track of stream.getTracks()) track.stop();
        } catch (error) {
            if (error?.name === 'MicrophoneTimeoutError') {
                // A late answer must not leave the microphone open.
                void request.then(stream => stream.getTracks().forEach(track => track.stop()), () => null);
                throw blocked('microphone_timeout', error);
            }
            const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
            throw blocked(denied ? 'microphone_denied' : 'microphone_unavailable', error);
        } finally {
            clearTimeout(timer);
        }
    }

    function detachElement(element) {
        const track = attachedMedia.get(element);
        try { track?.detach?.(element); } catch (_) { /* The room is already closing. */ }
        element.remove();
        attachedMedia.delete(element);
    }

    function removeTile(key) {
        const tile = tiles.get(key);
        if (!tile) return;
        for (const element of tile.tracks.values()) detachElement(element);
        tile.card.remove();
        tiles.delete(key);
    }

    function clearAttachedMedia() {
        for (const key of [...tiles.keys()]) removeTile(key);
        for (const element of [...attachedMedia.keys()]) detachElement(element);
        placeholderTile?.remove();
        placeholderTile = null;
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
        element.play?.().catch(() => setSoundBlocked(true));
        return element;
    }

    function syncTile(key, participant, isLocal) {
        let tile = tiles.get(key);
        if (!tile) {
            const card = document.createElement("article");
            card.className = "call-participant";
            const avatar = document.createElement('b'); avatar.className = 'call-participant-avatar';
            const label = document.createElement("span");
            card.append(avatar, label);
            tile = { card, avatar, label, tracks: new Map() };
            tiles.set(key, tile);
        }
        const name = isLocal ? "You" : participant.name || "Student";
        if (tile.label.textContent !== name) tile.label.textContent = name;
        if (tile.avatar.textContent !== name.slice(0, 1).toUpperCase()) tile.avatar.textContent = name.slice(0, 1).toUpperCase();
        const present = new Set();
        for (const publication of participant.trackPublications?.values?.() || []) {
            const track = publication.track;
            if (!track) continue;
            present.add(track);
            if (!tile.tracks.has(track)) tile.tracks.set(track, attachTrack(track, tile.card, isLocal));
        }
        for (const [track, element] of [...tile.tracks]) {
            if (present.has(track)) continue;
            detachElement(element);
            tile.tracks.delete(track);
        }
        let showsVideo = false;
        for (const [track, element] of tile.tracks) {
            if (track.kind !== 'video') continue;
            showsVideo = true;
            // The front-camera self view is mirrored, like every camera app.
            element.classList.toggle('mirrored', isLocal && facingMode === 'user');
        }
        tile.avatar.hidden = showsVideo;
        return tile.card;
    }

    function renderParticipants() {
        if (currentCall?.state === 'active' || room?.remoteParticipants.size > 0) ringbackFinished = true;
        if (outgoing && currentCall && mediaReady && !reconnecting && !ending && !ringbackFinished && !TERMINAL_STATES.has(currentCall.state)) ringback.play();
        else ringback.stop();
        const count = room?.remoteParticipants.size || 0;
        const connectionStatus = reconnecting ? 'Reconnecting…' : !mediaReady ? 'Connecting…' : count > 0 ? 'Connected' : currentCall?.state === 'active' ? 'Connecting audio…' : 'Waiting for an answer…';
        if (!room || (!room.remoteParticipants.size && !cameraEnabled)) {
            for (const key of [...tiles.keys()]) removeTile(key);
            if (!placeholderTile) {
                placeholderTile = document.createElement('div');
                placeholderTile.className = 'call-avatar';
                placeholderTile.append(Object.assign(document.createElement('b'), { className: 'call-participant-avatar' }));
            }
            const initial = titleNode.textContent.trim().slice(0, 1).toUpperCase();
            if (placeholderTile.firstChild.textContent !== initial) placeholderTile.firstChild.textContent = initial;
            if (mediaNode.firstChild !== placeholderTile || mediaNode.childNodes.length !== 1) mediaNode.replaceChildren(placeholderTile);
            if (room || outgoing) setStatus(connectionStatus);
            return;
        }
        if (placeholderTile) { placeholderTile.remove(); placeholderTile = null; }
        const order = [syncTile('local', room.localParticipant, true)];
        const keys = new Set(['local']);
        for (const [key, participant] of room.remoteParticipants.entries()) {
            const tileKey = `remote:${participant.identity || participant.sid || key}`;
            keys.add(tileKey);
            order.push(syncTile(tileKey, participant, false));
        }
        for (const key of [...tiles.keys()]) if (!keys.has(key)) removeTile(key);
        // Moving a playing element can pause it: only reorder when the order changed.
        if (order.some((card, index) => mediaNode.children[index] !== card) || mediaNode.children.length !== order.length) mediaNode.replaceChildren(...order);
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
            if (isCurrent(token)) setSoundBlocked(false);
        } catch (_) {
            if (isCurrent(token) && currentCall) setSoundBlocked(true);
        }
    }

    // One warning at a time; blocked sound first, since one tap fixes it.
    function renderAudioWarning() {
        const next = soundBlocked ? 'sound' : micSilent && !muted && room ? 'mic' : null;
        if (next && next !== audioWarning) audioHealth?.warningShown(next);
        audioWarning = next;
        audioWarningNode.hidden = !next;
        soundButton.classList.toggle('hidden', next !== 'sound');
        restartMicButton.classList.toggle('hidden', next !== 'mic');
        audioWarningText.textContent = next === 'sound' ? 'Your browser is blocking call sound.'
            : next === 'mic' ? 'Your mic isn’t picking up any sound. End any other call or app using it, then restart your mic.' : '';
    }

    function setSoundBlocked(value) {
        if (soundBlocked === value) return;
        soundBlocked = value;
        renderAudioWarning();
    }

    function setMicSilent(value) {
        if (micSilent === value) return;
        micSilent = value;
        renderAudioWarning();
    }

    function microphonePublication() {
        for (const publication of room?.localParticipant?.trackPublications?.values?.() || []) {
            const kind = publication.kind || publication.track?.kind;
            if (kind === 'audio' && (!publication.source || publication.source === 'microphone')) return publication;
        }
        return null;
    }

    function startAudioChecks(token) {
        audioHealth = new CallAudioHealth(Date.now());
        audioCall = { id: currentCall?.id, direction: outgoing ? 'outgoing' : 'incoming', mediaType: currentCall?.media_type };
        audioTimer = setInterval(() => { void sampleAudio(token); }, AUDIO_SAMPLE_INTERVAL_MS);
        void sampleAudio(token);
    }

    // Sends the summary once, for a call that connected.
    function stopAudioChecks() {
        clearInterval(audioTimer);
        audioTimer = null;
        if (audioHealth && audioCall) sendCallQualitySummary({ callId: audioCall.id, direction: audioCall.direction, mediaType: audioCall.mediaType, summary: audioHealth.summary(Date.now()) });
        audioHealth = null;
        audioCall = null;
        soundBlocked = false;
        micSilent = false;
        renderAudioWarning();
    }

    async function sampleAudio(token) {
        if (audioSampling || !isCurrent(token) || !room || !audioHealth) return;
        audioSampling = true;
        const sampleRoom = room, health = audioHealth;
        try {
            const micPublication = microphonePublication();
            const micTrack = micPublication?.track;
            const micOn = Boolean(micTrack) && !muted && !micPublication.isMuted;
            const statsOf = async track => { try { return await track?.getRTCStatsReport?.(); } catch (_) { return null; } };
            const outgoingAudio = micOn ? readOutgoingAudioStats(await statsOf(micTrack)) : null;
            let path = outgoingAudio?.path || null;
            const incoming = [];
            for (const participant of sampleRoom.remoteParticipants.values()) {
                for (const publication of participant.trackPublications?.values?.() || []) {
                    if ((publication.kind || publication.track?.kind) !== 'audio' || !publication.track || publication.isMuted) continue;
                    const stats = readIncomingAudioStats(await statsOf(publication.track));
                    if (!stats) continue;
                    incoming.push({ id: publication.trackSid || publication.track.sid || participant.identity, ...stats });
                    path ||= stats.path;
                }
            }
            if (!isCurrent(token) || room !== sampleRoom || audioHealth !== health) return;
            const capture = micTrack?.mediaStreamTrack;
            const remotes = [...sampleRoom.remoteParticipants.values()];
            const result = health.record({
                at: Date.now(),
                micOn,
                mic: micOn ? { energy: outgoingAudio?.energy, duration: outgoingAudio?.duration, trackMuted: capture?.muted === true, ended: capture?.readyState === 'ended' } : null,
                incoming,
                playbackBlocked: soundBlocked,
                quality: sampleRoom.localParticipant?.connectionQuality,
                remoteDegraded: remotes.some(participant => participant.connectionQuality === 'poor' || participant.connectionQuality === 'lost'),
                participants: remotes.length + 1,
                rttMs: path?.rttMs, candidate: path?.candidate, transport: path?.transport,
            });
            setMicSilent(result.micSilent);
        } finally {
            audioSampling = false;
        }
    }

    // Another app may have let go of the mic: ask the browser for it again.
    async function restartMicrophone() {
        if (!room || operationInFlight) return;
        const token = generation;
        operationInFlight = true;
        updateControls();
        try {
            const track = microphonePublication()?.track;
            if (track?.restartTrack) await track.restartTrack();
            else {
                await room.localParticipant.setMicrophoneEnabled(false);
                await room.localParticipant.setMicrophoneEnabled(true);
            }
            if (!isCurrent(token)) return;
            audioHealth?.micRestarted();
            setMicSilent(false);
        } catch (error) {
            if (isCurrent(token)) showToast?.(permissionMessage(error, 'audio'));
        } finally {
            if (isCurrent(token)) { operationInFlight = false; updateControls(); }
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
        room.on(liveKit.RoomEvent.Reconnecting, () => { if (isCurrent(token)) { reconnecting = true; audioHealth?.reconnectStarted(Date.now()); renderParticipants(); } });
        room.on(liveKit.RoomEvent.Reconnected, () => { if (isCurrent(token)) { reconnecting = false; audioHealth?.reconnectFinished(Date.now()); renderParticipants(); } });
        // LiveKit could not start remote audio without a tap.
        const playbackRoom = room;
        if (liveKit.RoomEvent.AudioPlaybackStatusChanged) room.on(liveKit.RoomEvent.AudioPlaybackStatusChanged, () => {
            if (isCurrent(token) && playbackRoom.canPlaybackAudio === false) setSoundBlocked(true);
        });
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
        void acquireWakeLock();
        startAudioChecks(token);
    }

    async function start(mediaType, chat) {
        const blocked = reason => reportCallStartBlocked(reason, { chatId: chat?.id, mediaType });
        if (!enabled()) { blocked('calls_unavailable'); return showToast?.("Calls are not available in this web release."); }
        if (currentCall || operationInFlight || ending) {
            blocked(currentCall ? 'already_in_call' : 'start_in_flight');
            return showToast?.("You’re already in a call.");
        }
        if (Number(chat?.accepted_count || 0) < 2 || chat?.has_viewer_blocked_member === true) {
            blocked('chat_unavailable');
            return showToast?.("This chat isn’t available for calls.");
        }
        operationInFlight = true;
        outgoing = true; ringbackFinished = false; mediaReady = false; reconnecting = false; ringback.prepare();
        const token = ++generation, callerId = userId();
        titleNode.textContent = chat.display_name || 'Call';
        setStatus('Connecting…'); setIncomingMode(false); renderParticipants(); showDialog(); updateControls();
        void acquireWakeLock();
        const key = `${chat.id}:${mediaType}`;
        const requestId = startRequestIds.get(key) || crypto.randomUUID();
        startRequestIds.set(key, requestId);
        if (startRequestIds.size > 32) startRequestIds.delete(startRequestIds.keys().next().value);
        try {
            await preflightPermissions(mediaType, { chatId: chat.id });
            if (!isCurrent(token)) return;
            const call = await api.startCall(callerId, chat.id, mediaType, requestId);
            if (!isCurrent(token)) {
                await api.endCall(callerId, call.id, { keepalive: true });
                notifyHistory(call);
                return;
            }
            startRequestIds.delete(key);
            currentCall = call;
            scheduleLifecycleCheck(call);
            titleNode.textContent = chat.display_name || call.caller_name || "Valid call";
            notifyHistory(call);
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

    function presentIncoming(call, { ring = true } = {}) {
        if (!enabled() || currentCall || operationInFlight || TERMINAL_STATES.has(call.state)) return;
        generation++;
        currentCall = call;
        scheduleLifecycleCheck(call);
        titleNode.textContent = call.caller_name || "Incoming call";
        setStatus(`Incoming ${call.media_type === "video" ? "video" : "voice"} call`);
        hideCompactBar();
        setIncomingMode(true);
        renderParticipants();
        showDialog();
        if (ring) startIncomingAlert();
        void acquireWakeLock();
    }

    // ?call=<id> (a call notification or chat link). `answer` comes from the
    // notification's Answer action: accept at once instead of ringing again.
    async function open(callId, { answer = false } = {}) {
        // Answer tapped while this page already rings for the same call.
        if (answer && currentCall && String(currentCall.id) === String(callId) && currentCall.viewer_invitation_state === "invited" && !operationInFlight && !ending) return accept();
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
                await preflightPermissions(call.media_type, { chatId: call.chat_id });
                if (!isCurrent(token)) return;
                await connectToCall(call, token);
            } else {
                operationInFlight = false;
                const answerNow = answer && call.viewer_invitation_state === "invited";
                presentIncoming(call, { ring: !answerNow });
                if (answerNow && currentCall && String(currentCall.id) === String(call.id)) await accept();
            }
        } catch (error) {
            if (!isCurrent(token)) return;
            if (currentCall) await finish({ notifyBackend: true });
            const permission = ["MicrophoneTimeoutError", "NotAllowedError", "SecurityError", "NotFoundError", "NotSupportedError"].includes(error?.name);
            showToast?.(permission ? permissionMessage(error, currentCall?.media_type || "audio") : userMessage(error, "That call is no longer available."));
        } finally { if (isCurrent(token)) { operationInFlight = false; updateControls(); } }
    }

    async function accept() {
        if (!currentCall || operationInFlight) return;
        stopIncomingAlert();
        operationInFlight = true;
        const token = generation, call = currentCall;
        updateControls();
        try {
            await preflightPermissions(call.media_type, { chatId: call.chat_id, direction: 'incoming' });
            if (!isCurrent(token)) return;
            const accepted = await api.acceptCall(userId(), call.id);
            if (!isCurrent(token)) return;
            currentCall = accepted;
            notifyHistory(accepted);
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
        stopIncomingAlert();
        const token = generation;
        operationInFlight = true;
        let declined = false;
        try {
            await api.declineCall(userId(), currentCall.id);
            declined = true;
        }
        catch (error) { showToast?.(userMessage(error, "Could not decline the call.")); }
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
                await room.localParticipant.setCameraEnabled(true, { facingMode });
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

    function localCameraTrack() {
        for (const publication of room?.localParticipant?.trackPublications?.values?.() || []) {
            if (publication.track?.kind === 'video' && (!publication.source || publication.source === 'camera')) return publication.track;
        }
        return null;
    }

    async function flipCamera() {
        if (!room || !cameraEnabled || operationInFlight) return;
        const token = generation, next = facingMode === 'user' ? 'environment' : 'user';
        operationInFlight = true;
        updateControls();
        try {
            const track = localCameraTrack();
            if (track?.restartTrack) await track.restartTrack({ facingMode: next });
            else {
                await room.localParticipant.setCameraEnabled(false);
                await room.localParticipant.setCameraEnabled(true, { facingMode: next });
            }
            if (!isCurrent(token)) return;
            facingMode = next;
            renderParticipants();
        } catch (_) {
            if (isCurrent(token)) showToast?.('Could not switch cameras.');
        } finally {
            if (isCurrent(token)) { operationInFlight = false; updateControls(); }
        }
    }

    // A hidden page cannot keep the camera running on most phones; release it
    // (keeping the server's video slot) and bring it back on return.
    async function handleVisibility() {
        if (!currentCall) return;
        if (document.hidden) {
            if (cameraEnabled && room && !operationInFlight) {
                cameraPausedForBackground = true;
                audioHealth?.cameraPaused();
                try { await room.localParticipant.setCameraEnabled(false); } catch (_) { /* Already stopped. */ }
            }
            return;
        }
        if (wantWakeLock) void acquireWakeLock();
        if (cameraPausedForBackground && room) {
            cameraPausedForBackground = false;
            try { await room.localParticipant.setCameraEnabled(true, { facingMode }); } catch (_) { /* Permission revoked meanwhile. */ }
            renderParticipants();
        }
        if (room) void enableAudioPlayback();
    }
    document.addEventListener('visibilitychange', () => { void handleVisibility(); });

    async function confirmLeave() {
        if (leavePromptOpen || !currentCall) return;
        leavePromptOpen = true;
        try {
            const leave = await confirmSheet({
                title: 'Leave call?',
                message: 'Everyone else can keep talking. To keep the call going while you use Valid, minimize it instead.',
                confirmLabel: 'Leave', cancelLabel: 'Stay', destructive: true,
            });
            if (leave && currentCall) void finish();
        } finally {
            leavePromptOpen = false;
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
        } catch (error) { showToast?.(userMessage(error, "Could not change the microphone.")); }
        finally { if (isCurrent(token)) { operationInFlight = false; updateControls(); } }
    }

    async function finish({ notifyBackend = true, keepalive = false, outcome = null } = {}) {
        const call = currentCall;
        if (ending) return;
        generation++;
        ending = true;
        stopIncomingAlert();
        releaseWakeLock();
        hideCompactBar();
        facingMode = 'user';
        cameraPausedForBackground = false;
        ringback.dispose(); outgoing = false; ringbackFinished = false;
        mediaReady = false; reconnecting = false;
        stopAudioChecks();
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
                    const updated = await api[method](userId(), call.id, { keepalive });
                    if (!keepalive) notifyHistory(updated?.chat_id ? updated : call);
                    lastError = null;
                    break;
                } catch (error) {
                    lastError = error;
                    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
                }
            }
            if (lastError && !keepalive) showToast?.(userMessage(lastError, "The server could not confirm that you left."));
        }
        if (call && !notifyBackend && !keepalive) notifyHistory(call);
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
            // Still ringing here but answered or declined on another device.
            const ringingHere = currentCall.viewer_invitation_state === "invited" && !operationInFlight;
            if (ringingHere && ["accepted", "declined"].includes(call.viewer_invitation_state)) {
                return finish({ notifyBackend: false, outcome: call.viewer_invitation_state === "accepted" ? "Answered on another device" : "Call declined" });
            }
            currentCall = call;
            scheduleLifecycleCheck(call);
            if (TERMINAL_STATES.has(call.state)) return finish({ notifyBackend: false, outcome: callOutcome(call.state) });
            renderParticipants();
        } catch (_) {
            if (isCurrent(token) && currentCall) setStatus('Reconnecting…');
        }
    }

    compactBar.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.matches('[data-call-restore]')) restoreCall();
        if (button.matches('[data-call-compact-mute]')) void toggleMute();
        if (button.matches('[data-call-compact-end]')) void finish();
    });
    dialog.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        if (button.matches('[data-call-dismiss]')) { dialog.close(); return; }
        if (button.matches('[data-call-minimize]')) { showCompactBar(); return; }
        if (button.matches('[data-call-flip]')) { void flipCamera(); return; }
        void enableAudioPlayback();
        if (button.matches("[data-call-accept]")) void accept();
        if (button.matches("[data-call-decline]")) void decline();
        if (button.matches("[data-call-hangup]")) void finish();
        if (button.matches("[data-call-audio]")) void toggleMute();
        if (button.matches("[data-call-video]")) void setCamera(!cameraEnabled);
        if (button.matches('[data-call-output]')) void chooseAudioOutput();
        if (button.matches("[data-call-enable-sound]")) void enableAudioPlayback();
        if (button.matches('[data-call-restart-mic]')) void restartMicrophone();
    });
    // Esc and Android Back never hang up by themselves.
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        if (!currentCall) { if (!operationInFlight && !ending) dialog.close(); return; }
        if (currentCall.viewer_invitation_state === "invited") void decline();
        else void confirmLeave();
    });
    window.addEventListener("pagehide", (event) => {
        if (currentCall || operationInFlight) void finish({ notifyBackend: true, keepalive: true });
    });
    window.addEventListener("valid:session-expired", () => {
        if (currentCall || operationInFlight) void finish({ notifyBackend: false });
    });
    // Reloading or closing the tab ends the call: ask first, but only during one.
    window.addEventListener("beforeunload", (event) => {
        if (!currentCall || TERMINAL_STATES.has(currentCall.state)) return;
        event.preventDefault();
        event.returnValue = "";
    });

    return { enabled, start, open, handleRealtimeEvent, isActive: () => Boolean(currentCall || operationInFlight || ending), beforeSessionEnd: () => finish({ notifyBackend: true }) };
}
