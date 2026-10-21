import { userMessage } from "./user-message.js";
import { startCodeResendCountdown } from "./ui-dialogs.js";
// The permission request is separate from user authentication. This module
// never creates a child session or changes a feature flag.
const RECEIPT_KEY = "valid:parent-approval-receipt";
const receiptHeaders = (token) => ({ "X-Parent-Approval-Token": token });
export function savedApprovalReceipt() {
    try { const value = JSON.parse(localStorage.getItem(RECEIPT_KEY) || "null"); return /^pa_[a-f0-9]{64}$/.test(value?.token || "") && Date.parse(value.expiresAt) > Date.now() ? value : null; } catch { return null; }
}
export function forgetApprovalReceipt() { try { localStorage.removeItem(RECEIPT_KEY); } catch { /* Optional receipt. */ } }

export async function openParentApproval({ api, age, deviceId, escapeHTML: esc, resume = false }) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal friends-dialog parity-page parent-approval-dialog";
    dialog.setAttribute("aria-label", "Parent permission");
    let token = resume ? savedApprovalReceipt()?.token : null;
    let policy, stream = null, photo = null, previewURL = null, closed = false, busy = false, submitted = false, cameraEpoch = 0, codeTimer = null, phoneRequired = false;
    let resolve;
    const finished = new Promise((done) => { resolve = done; });
    const stopCamera = () => { stream?.getTracks().forEach((track) => track.stop()); stream = null; };
    const status = (message) => { if (!closed) dialog.querySelector("[role=status]").textContent = message; };
    const content = (markup) => { ++cameraEpoch; stopCamera(); clearInterval(codeTimer); photo = null; if (previewURL) URL.revokeObjectURL(previewURL); previewURL = null; if (!closed) dialog.querySelector("[data-parent-content]").innerHTML = markup; };
    const call = (path, options = {}) => api.request(path, { auth: false, credentials: "omit", ...options, headers: { ...receiptHeaders(token), ...options.headers } });
    function showOutcome(result) {
        if (result.status === "approved") {
            content('<h3>Permission approved</h3><p>Continue creating the account.</p><button class="primary-button" type="button" data-parent-continue>Continue signup</button>');
        } else if (["rejected", "revoked", "expired"].includes(result.status)) {
            content(`<h3>${esc(result.status === "expired" ? "Request expired" : "Permission unavailable")}</h3><p>${esc(result.reason || "Return to age selection to start a new attempt.")}</p>`);
        } else if (result.needs_parent_code) showPhone(true);
        else content(`<h3>Approval request</h3><p>${esc(result.reason || "Your request has not been approved yet. You can check its status or take a new photo.")}</p><button class="secondary-button" type="button" data-parent-check>Check status</button><button class="secondary-button" type="button" data-parent-camera>Take approval photo</button>`);
    }
    function showPhone(required = false) {
        phoneRequired = required;
        content(`<h3>${required ? "Confirm your parent’s phone" : "Optional parent monitoring"}</h3><p>Your parent can read the account's chats and feed and manage privacy. Their own number is verified by text. ${required ? "The photo check requires a parent phone code for this request." : "Adding their number is optional and separate from permission."}</p><form data-parent-phone-form><label>Parent’s phone number<input type="tel" name="phone" autocomplete="tel" required minlength="10" maxlength="20"></label><button class="primary-button" type="submit">Send parent code</button></form>${required ? "" : '<button class="text-button" type="button" data-parent-camera>Skip monitoring</button>'}`);
    }
    async function camera() {
        content('<h3>Approval photo</h3><p>Parent or guardian: take a fresh photo of yourself giving a thumbs up. Your full camera frame will be submitted for review.</p><video data-parent-video autoplay playsinline muted></video><button class="primary-button" type="button" data-parent-capture disabled>Take photo</button><button class="secondary-button" type="button" data-parent-camera>Try camera again</button>');
        const cameraGeneration = cameraEpoch;
        status("Requesting camera access…");
        try {
            if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is unavailable. Open Valid in a browser with camera access and try again.");
            const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 1600 }, height: { ideal: 1200 } } });
            if (closed || cameraGeneration !== cameraEpoch || !dialog.querySelector("[data-parent-video]")) { next.getTracks().forEach((track) => track.stop()); return; }
            stopCamera(); stream = next;
            const video = dialog.querySelector("video"); video.srcObject = next; await video.play();
            if (closed || cameraGeneration !== cameraEpoch) return;
            dialog.querySelector("[data-parent-capture]").disabled = false; status("");
        } catch (error) { if (cameraGeneration !== cameraEpoch) return; status(error.name === "NotAllowedError" ? "Camera access was denied. Allow it in browser settings, then try again." : userMessage(error, "The camera could not start. Try again.")); }
    }
    dialog.innerHTML = '<header class="parity-page-header"><button class="parity-back" type="button" data-parent-close aria-label="Back to age selection">‹</button><h2>Parent permission</h2><span></span></header><div class="parity-page-content" data-parent-content></div><p class="parity-status" role="status"></p>';
    document.body.append(dialog); dialog.showModal();
    dialog.addEventListener("close", () => { closed = true; stopCamera(); clearInterval(codeTimer); if (previewURL) URL.revokeObjectURL(previewURL); photo = null; dialog.remove(); resolve(submitted ? token : null); }, { once: true });
    dialog.addEventListener("click", async (event) => {
        const button = event.target.closest("button"); if (!button || button.disabled) return;
        if (button.matches("[data-parent-close]")) return dialog.close();
        if (busy) return;
        if (button.matches("[data-parent-phone-change]")) { showPhone(phoneRequired); status(""); return; }
        if (button.matches("[data-parent-policy-retry]")) return void loadPolicy();
        if (button.matches("[data-parent-continue]")) { submitted = true; return dialog.close(); }
        if (button.matches("[data-parent-camera]")) return void camera();
        if (button.matches("[data-parent-capture]")) {
            const epoch = cameraEpoch;
            const video = dialog.querySelector("video"); if (!video.videoWidth) return;
            const canvas = document.createElement("canvas"), scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
            canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise((done) => canvas.toBlob(done, "image/jpeg", 0.82));
            if (closed || epoch !== cameraEpoch || !blob) return;
            content('<h3>Review your approval photo</h3><img data-parent-preview alt="Your approval photo"><button class="secondary-button" type="button" data-parent-camera>Retake</button><button class="primary-button" type="button" data-parent-upload>Use photo</button>');
            photo = blob; previewURL = URL.createObjectURL(blob); dialog.querySelector("img").src = previewURL; return;
        }
        busy = true; button.disabled = true; status("Checking…");
        try {
            if (button.matches("[data-parent-start]")) {
                if (!dialog.querySelector("[data-parent-consent]").checked) { status("Your parent must read the notice and give permission to continue."); return; }
                token = `pa_${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
                const result = await call("/parent-approvals/request", { method: "POST", body: JSON.stringify({ age, device_installation_id: deviceId, notice_version: policy.version, consent: true }) });
                if (closed) return;
                try { localStorage.setItem(RECEIPT_KEY, JSON.stringify({ token, expiresAt: result.expires_at })); } catch { /* Signup can continue without a saved receipt. */ }
                showPhone();
            } else if (button.matches("[data-parent-check]")) showOutcome(await call("/parent-approvals/status"));
            else if (button.matches("[data-parent-resend]")) {
                const phone = dialog.querySelector('[name="phone"]').value;
                const result = await call("/parent-approvals/phone/request", { method: "POST", body: JSON.stringify({ phone_number: phone }) });
                if (!closed) { clearInterval(codeTimer); codeTimer = startCodeResendCountdown(button, result.resend_available_at); }
            }
            else if (button.matches("[data-parent-upload]")) {
                if (!photo || photo.size > 2 * 1024 * 1024) throw new Error("Please retake a smaller photo.");
                status("Checking the approval photo. Keep this page open…");
                const result = await call("/parent-approvals/photo", { method: "POST", body: photo, headers: { "Content-Type": "image/jpeg" }, timeoutMs: 120_000 });
                if (!closed) showOutcome(result);
            }
            status("");
        } catch (error) {
            if (button.matches("[data-parent-resend]")) button.disabled = false;
            status(userMessage(error, "Couldn't complete this step. Check the status before trying again."));
            if (!closed && token && !dialog.querySelector("[data-parent-check]")) dialog.querySelector("[data-parent-content]").insertAdjacentHTML("beforeend", '<button class="secondary-button" type="button" data-parent-check>Check status</button>');
        }
        finally { busy = false; if (button.isConnected && !button.matches("[data-parent-resend]")) button.disabled = false; }
    });
    dialog.addEventListener("submit", async (event) => {
        event.preventDefault(); if (busy) return;
        const form = event.target, fields = new FormData(form), phone = fields.get("phone"), code = fields.get("code");
        busy = true; form.querySelector("button").disabled = true; status("Checking…");
        try {
            if (!code) {
                const result = await call("/parent-approvals/phone/request", { method: "POST", body: JSON.stringify({ phone_number: phone }) });
                if (closed) return;
                content(`<form data-parent-phone-form><input type="hidden" name="phone" value="${esc(phone)}"><label>Parent code<input name="code" inputmode="numeric" autocomplete="one-time-code" required minlength="4" maxlength="10"></label><button class="primary-button" type="submit">Verify parent code</button><button class="secondary-button" type="button" data-parent-resend>Resend Code</button><button class="text-button" type="button" data-parent-phone-change>Use another number</button></form>`);
                codeTimer = startCodeResendCountdown(dialog.querySelector("[data-parent-resend]"), result.resend_available_at);
            } else {
                const result = await call("/parent-approvals/phone/confirm", { method: "POST", body: JSON.stringify({ phone_number: phone, code }) });
                if (!closed) { if (result.status === "approved") showOutcome(result); else { status(""); void camera(); return; } }
            }
            status("");
        } catch (error) { status(userMessage(error, "Couldn't complete this step. Try again.")); }
        finally { busy = false; if (form.isConnected) form.querySelector("button").disabled = false; }
    });
    async function loadPolicy() {
      try {
        policy = await api.request("/parent-approvals/policy", { auth: false, credentials: "omit" });
        if (closed) return finished;
        if (resume && token) showOutcome(await call("/parent-approvals/status"));
        else if (policy.enabled !== true) content('<p>Signup for this age is unavailable right now. Return to age selection.</p>');
        else content(`<h3>${esc(policy.title)}</h3><p>Please hand this device to your parent or guardian.</p>${["account", "sharing", "privacy", "choices"].map((key) => `<p>${esc(policy[key] || "")}</p>`).join("")}<a href="https://validapp.lol/privacy-policy.html" target="_blank" rel="noopener">Privacy Policy</a><label class="friend-setting"><span>${esc(policy.statement)}</span><input type="checkbox" data-parent-consent></label><button class="primary-button" type="button" data-parent-start>Give permission</button>`);
      } catch (error) { status(userMessage(error, "Couldn't complete this step. Try again.")); content('<button class="secondary-button" type="button" data-parent-policy-retry>Try again</button>'); }
    }
    await loadPolicy();
    return finished;
}
