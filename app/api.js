const DEFAULT_API_BASE = "https://api.six7.lol/api/v1";
export class APIError extends Error {
    constructor(message, status, detail, retryAfterSeconds = null) {
        super(message);
        this.name = "APIError";
        this.status = status;
        this.detail = detail;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

function retryAfterSeconds(value) {
    if (!value) return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return Math.min(86_400, Math.max(1, Math.ceil(numeric)));
    const date = Date.parse(value);
    if (Number.isNaN(date)) return null;
    return Math.min(86_400, Math.max(1, Math.ceil((date - Date.now()) / 1000)));
}

function retryMessage(seconds) {
    if (!seconds) return "Too many requests. Please try again shortly.";
    if (seconds < 60) return `Too many requests. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
    const minutes = Math.ceil(seconds / 60);
    return `Too many requests. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

export class ValidAPI {
    constructor() {
        this.baseURL = window.VALID_API_BASE_URL || DEFAULT_API_BASE;
        // Keep bearer material in memory only. A refresh intentionally requires
        // another passkey gesture instead of leaving a reusable secret in web storage.
        this.token = null;
        this.user = null;
    }

    hasSession() {
        return Boolean(this.token && this.user?.id);
    }

    saveSession(loginResponse) {
        this.token = loginResponse.access_token;
        this.user = loginResponse.user;
    }

    clearSession() {
        this.token = null;
        this.user = null;
    }

    async request(path, options = {}) {
        const headers = new Headers(options.headers || {});
        headers.set("Accept", "application/json");

        if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }
        if (options.auth !== false && this.token) {
            headers.set("Authorization", `Bearer ${this.token}`);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15_000);
        if (options.signal) {
            if (options.signal.aborted) controller.abort();
            else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
        }
        let response;
        try {
            response = await fetch(`${this.baseURL}${path}`, {
                ...options,
                headers,
                signal: controller.signal,
                credentials: "omit",
            });
        } catch (error) {
            if (error.name === "AbortError") throw new APIError("That request took too long. Check your connection and try again.", 408);
            throw new APIError("Could not reach Valid. Check your connection and try again.", 0);
        } finally {
            clearTimeout(timeout);
        }

        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json")
            ? await response.json().catch(() => null)
            : await response.text().catch(() => "");

        if (!response.ok) {
            if (response.status === 401) {
                this.clearSession();
                window.dispatchEvent(new CustomEvent("valid:session-expired"));
            }
            const detail = payload?.detail ?? payload;
            const waitSeconds = response.status === 429
                ? retryAfterSeconds(response.headers.get("retry-after"))
                : null;
            const message = response.status === 429
                ? retryMessage(waitSeconds)
                : typeof detail === "string"
                ? detail
                : detail?.message || `Request failed (${response.status})`;
            throw new APIError(message, response.status, detail, waitSeconds);
        }

        return payload;
    }

    assetURL(path) {
        if (!path) return null;
        try {
            return new URL(path).href;
        } catch (_) {
            return new URL(path, new URL(this.baseURL).origin).href;
        }
    }

    getPasskeyChallenge() {
        return this.request("/auth/passkey/authenticate/challenge", { auth: false });
    }

    authenticatePasskey(assertion) {
        return this.request("/auth/passkey/authenticate", {
            method: "POST",
            auth: false,
            body: JSON.stringify(assertion),
        });
    }

    getWebSignupChallenge(username) {
        return this.request("/auth/passkey/signup/challenge", {
            method: "POST",
            auth: false,
            body: JSON.stringify({ username }),
        });
    }

    completeWebSignup(payload) {
        return this.request("/auth/passkey/signup/complete", {
            method: "POST",
            auth: false,
            body: JSON.stringify(payload),
        });
    }

    resolveSchool(payload) {
        return this.request("/highschools/request", {
            method: "POST",
            auth: false,
            body: JSON.stringify(payload),
        });
    }

    logout() {
        return this.request("/auth/logout", { method: "POST" });
    }

    getProfile(userId) {
        return this.request(`/users/${userId}/profile`);
    }

    getTopQuestions(userId, period = "weekly", limit = 10) {
        const params = new URLSearchParams({ period, limit: String(limit) });
        return this.request(`/users/${userId}/top-questions?${params}`);
    }

    getPersonalFeed(userId, offset = 0) {
        return this.request(`/users/${userId}/feed?limit=20&offset=${offset}`);
    }

    getSchoolFeed(userId, cursor = null) {
        const params = new URLSearchParams({ limit: "20" });
        if (cursor?.timestamp) params.set("before_ts", cursor.timestamp);
        if (cursor?.id) params.set("before_id", String(cursor.id));
        return this.request(`/users/${userId}/feed/school?${params}`);
    }

    getUserVotes(userId, cursor = null) {
        const params = new URLSearchParams({ limit: "20" });
        if (cursor?.timestamp) params.set("before_ts", cursor.timestamp);
        if (cursor?.id) params.set("before_id", String(cursor.id));
        return this.request(`/users/${userId}/votes?${params}`);
    }

    toggleUpvote(userId, questionAnswerId) {
        return this.request(`/users/${userId}/feed/upvote/${questionAnswerId}`, { method: "POST" });
    }

    reportQuestion(userId, questionId, reason = "inappropriate") {
        const params = new URLSearchParams({ reason });
        return this.request(`/users/${userId}/questions/${questionId}/report-question?${params}`, { method: "POST" });
    }

    blockQuestionSubmitter(userId, questionId) {
        return this.request(`/users/${userId}/questions/${questionId}/block-submitter`, { method: "POST" });
    }

    getPlayQuestions(userId) {
        return this.request(`/users/${userId}/questions/unanswered`);
    }

    getConfig() {
        return this.request("/config", { auth: false });
    }

    getClassmates(userId) {
        return this.request(`/users/${userId}/classmates?limit=500`);
    }

    getClassmatesStatus(userId) {
        return this.request(`/users/${userId}/classmates/status`);
    }

    addContacts(userId, contacts) {
        return this.request(`/users/${userId}/contacts`, {
            method: "POST",
            body: JSON.stringify(contacts),
        });
    }

    answerQuestion(userId, payload) {
        return this.request(`/users/${userId}/question-answers`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    skipQuestion(userId, questionId) {
        return this.request(`/users/${userId}/questions/${questionId}/skip`, { method: "POST" });
    }

    submitQuestion(userId, formData) {
        return this.request(`/users/${userId}/question-submissions`, {
            method: "POST",
            body: formData,
        });
    }

    getInviteStatus(userId) {
        return this.request(`/users/${userId}/invites/status`);
    }

    createInvite(userId, shareChannel = "web") {
        return this.request(`/users/${userId}/invites`, {
            method: "POST",
            body: JSON.stringify({ share_channel: shareChannel }),
        });
    }

    updateBio(userId, bio) {
        return this.request(`/users/${userId}/bio`, {
            method: "PUT",
            body: JSON.stringify({ bio }),
        });
    }

    updateInformation(userId, profile) {
        return this.request(`/users/${userId}/information`, {
            method: "PUT",
            body: JSON.stringify(profile),
        });
    }

    uploadProfilePicture(userId, file) {
        const formData = new FormData();
        formData.set("file", file);
        return this.request(`/users/${userId}/profile-picture`, {
            method: "POST",
            body: formData,
        });
    }

    getAskLink(userId) {
        return this.request(`/users/${userId}/ask-link`);
    }

    setAskLinkActive(userId, isActive) {
        return this.request(`/users/${userId}/ask-link`, {
            method: "PATCH",
            body: JSON.stringify({ is_active: isActive }),
        });
    }

    rotateAskLink(userId) {
        return this.request(`/users/${userId}/ask-link/rotate`, { method: "POST" });
    }

    trackAskShare(userId, platform) {
        return this.request(`/users/${userId}/ask-shares`, {
            method: "POST",
            body: JSON.stringify({ platform }),
        });
    }

    getAnonymousInbox(userId, limit = 30, offset = 0) {
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        return this.request(`/users/${userId}/anonymous-inbox?${params}`);
    }

    openAnonymousQuestion(userId, questionId) {
        return this.request(`/users/${userId}/anonymous-questions/${questionId}/open`, { method: "POST" });
    }

    answerAnonymousQuestion(userId, questionId, answerText) {
        return this.request(`/users/${userId}/anonymous-questions/${questionId}/answer`, {
            method: "POST",
            body: JSON.stringify({ answer_text: answerText }),
        });
    }

    reportAnonymousQuestion(userId, questionId) {
        return this.request(`/users/${userId}/anonymous-questions/${questionId}/report`, { method: "POST" });
    }

    blockAnonymousQuestion(userId, questionId) {
        return this.request(`/users/${userId}/anonymous-questions/${questionId}/block`, { method: "POST" });
    }

    deleteAnonymousQuestion(userId, questionId) {
        return this.request(`/users/${userId}/anonymous-questions/${questionId}`, { method: "DELETE" });
    }

    requestAccountDeletion(userId) {
        return this.request(`/users/${userId}/delete`, { method: "POST" });
    }

    cancelAccountDeletion(userId) {
        return this.request(`/users/${userId}/delete/cancel`, { method: "POST" });
    }

}
