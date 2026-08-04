const DEFAULT_API_BASE = "https://api.six7.lol/api/v1";
export class APIError extends Error {
    constructor(message, status, detail) {
        super(message);
        this.name = "APIError";
        this.status = status;
        this.detail = detail;
    }
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

        const response = await fetch(`${this.baseURL}${path}`, {
            ...options,
            headers,
            credentials: "omit",
        });

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
            const message = typeof detail === "string"
                ? detail
                : detail?.message || `Request failed (${response.status})`;
            throw new APIError(message, response.status, detail);
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

    getPlayQuestions(userId) {
        return this.request(`/users/${userId}/questions/unanswered`);
    }

    getClassmates(userId) {
        return this.request(`/users/${userId}/classmates?limit=500`);
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

}
