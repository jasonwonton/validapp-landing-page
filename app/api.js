function apiBaseURL() {
    // Browser auth is first-party: production hosting must reverse-proxy this
    // path to the API just like the local HTTPS server does.
    return window.VALID_API_BASE_URL || `${window.location.origin}/api/v1`;
}

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
        this.baseURL = apiBaseURL();
        // Native clients keep bearer auth. Web sessions use an HttpOnly cookie,
        // so no reusable browser credential is stored or exposed to JavaScript.
        this.token = null;
        this.user = null;
    }

    hasSession() {
        return Boolean(this.user?.id);
    }

    saveSession(loginResponse) {
        this.token = loginResponse.access_token || null;
        this.user = loginResponse.user;
    }

    clearSession() {
        this.token = null;
        this.user = null;
    }

    async request(path, options = {}) {
        const includeResponseHeaders = options.includeResponseHeaders === true;
        const silentAuthFailure = options.silentAuthFailure === true;
        const fetchOptions = { ...options };
        delete fetchOptions.includeResponseHeaders;
        delete fetchOptions.silentAuthFailure;
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
                ...fetchOptions,
                headers,
                signal: controller.signal,
                credentials: "include",
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
                if (!silentAuthFailure) window.dispatchEvent(new CustomEvent("valid:session-expired"));
            }
            const detail = payload?.detail ?? payload;
            const waitSeconds = response.status === 429
                ? retryAfterSeconds(response.headers.get("retry-after"))
                : null;
            const detailIsHTML = typeof detail === "string" && /<!doctype|<html|<body|<head/i.test(detail);
            const message = !contentType.includes("application/json") && (response.status >= 500 || detailIsHTML)
                ? (response.status === 404 ? "That request is not available right now." : "Valid is temporarily unavailable. Please try again in a moment.")
                : response.status === 429
                ? retryMessage(waitSeconds)
                : typeof detail === "string"
                ? detail
                : detail?.message || `Request failed (${response.status})`;
            throw new APIError(message, response.status, detail, waitSeconds);
        }

        return includeResponseHeaders ? { data: payload, headers: response.headers } : payload;
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

    checkUsernameAvailability(username) {
        return this.request(`/users/username-available/${encodeURIComponent(username)}`, { auth: false });
    }

    checkPhoneRegistration(phoneNumber, deviceInstallationId) {
        return this.request("/users/phone-check", {
            method: "POST",
            auth: false,
            body: JSON.stringify({
                phone_number: phoneNumber,
                device_installation_id: deviceInstallationId,
            }),
        });
    }

    requestPhoneVerification(phoneNumber, turnstileToken) {
        return this.request("/auth/phone/request/web", {
            method: "POST",
            auth: false,
            body: JSON.stringify({
                phone_number: phoneNumber,
                channel: "sms",
                turnstile_token: turnstileToken,
            }),
        });
    }

    confirmPhoneVerification(phoneNumber, code) {
        return this.request("/auth/phone/confirm", {
            method: "POST",
            auth: false,
            body: JSON.stringify({ phone_number: phoneNumber, code }),
        });
    }

    completeWebSignup(payload) {
        return this.request("/auth/passkey/signup/complete", {
            method: "POST",
            auth: false,
            body: JSON.stringify(payload),
        });
    }

    getPasskeyRegistrationChallenge(userId) {
        const params = new URLSearchParams({ userId });
        return this.request(`/auth/passkey/register/challenge?${params}`);
    }

    registerPasskey(payload) {
        return this.request("/auth/passkey/register", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    getPasskeyStatus() {
        return this.request("/auth/passkey/status");
    }

    resolveSchool(payload) {
        return this.request("/highschools/request", {
            method: "POST",
            auth: false,
            body: JSON.stringify(payload),
        });
    }

    getNearbySchools(zipCode, limit = 50) {
        const params = new URLSearchParams({ zip_code: zipCode, limit: String(Math.min(50, Math.max(1, limit))) });
        return this.request(`/highschools/nearby?${params}`, { auth: false });
    }

    logout() {
        return this.request("/auth/logout", { method: "POST" });
    }

    restoreSession() {
        return this.request("/auth/session", { auth: false, silentAuthFailure: true });
    }

    getProfile(userId) {
        return this.request(`/users/${userId}/profile`);
    }

    getUser(userId) {
        return this.request(`/users/${userId}`);
    }

    getTopQuestions(userId, period = "weekly", limit = 10) {
        const params = new URLSearchParams({ period, limit: String(limit) });
        return this.request(`/users/${userId}/top-questions?${params}`);
    }

    getPersonalFeed(userId, offset = 0, search = "") {
        const params = new URLSearchParams({ limit: "20", offset: String(offset) });
        if (search.trim()) params.set("search", search.trim());
        return this.request(`/users/${userId}/feed?${params}`);
    }

    getSchoolFeed(userId, cursor = null, search = "", sort = "recent", limit = 20) {
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor?.timestamp) params.set("before_ts", cursor.timestamp);
        if (cursor?.id) params.set("before_id", String(cursor.id));
        if (search.trim()) params.set("search", search.trim());
        if (sort !== "recent") params.set("sort", sort);
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

    setFeedReaction(userId, questionAnswerId, reactionType) {
        return this.request(`/users/${userId}/feed/reactions/${questionAnswerId}`, {
            method: "PUT",
            body: JSON.stringify({ reaction_type: reactionType }),
        });
    }

    removeFeedReaction(userId, questionAnswerId) {
        return this.request(`/users/${userId}/feed/reactions/${questionAnswerId}`, { method: "DELETE" });
    }

    getFeedReactors(userId, questionAnswerId, reactionType = "") {
        const params = new URLSearchParams();
        if (reactionType) params.set("reaction_type", reactionType);
        const query = params.size ? `?${params}` : "";
        return this.request(`/users/${userId}/feed/reactions/${questionAnswerId}${query}`);
    }

    getFeedItem(userId, questionAnswerId) {
        return this.request(`/users/${userId}/feed/item/${questionAnswerId}`);
    }

    getCommentModerationState(userId) {
        return this.request(`/users/${userId}/comment-moderation/notice`);
    }

    acknowledgeCommentModerationNotice(userId, noticeId) {
        return this.request(`/users/${userId}/comment-moderation/notices/${noticeId}/acknowledge`, { method: "POST" });
    }

    listPollComments(userId, questionAnswerId, before = null, limit = 30) {
        const params = new URLSearchParams({ limit: String(limit) });
        if (before?.created_at) params.set("before_created_at", before.created_at);
        if (before?.id) params.set("before_id", String(before.id));
        return this.request(`/users/${userId}/feed/polls/${questionAnswerId}/comments?${params}`);
    }

    getPollComment(userId, questionAnswerId, commentId) {
        return this.request(`/users/${userId}/feed/polls/${questionAnswerId}/comments/${commentId}`);
    }

    listPollCommentReplies(userId, questionAnswerId, rootCommentId, after = null, limit = 50) {
        const params = new URLSearchParams({ limit: String(limit) });
        if (after?.created_at) params.set("after_created_at", after.created_at);
        if (after?.id) params.set("after_id", String(after.id));
        return this.request(`/users/${userId}/feed/polls/${questionAnswerId}/comments/${rootCommentId}/replies?${params}`);
    }

    createPollComment(userId, questionAnswerId, body, clientRequestId, parentCommentId = null) {
        return this.request(`/users/${userId}/feed/polls/${questionAnswerId}/comments`, {
            method: "POST",
            body: JSON.stringify({ body, client_request_id: clientRequestId, ...(parentCommentId ? { parent_comment_id: parentCommentId } : {}) }),
        });
    }

    setPollCommentReaction(userId, questionAnswerId, commentId, reactionType) {
        return this.request(`/users/${userId}/feed/polls/${questionAnswerId}/comments/${commentId}/reaction`, {
            method: "PUT",
            body: JSON.stringify({ reaction_type: reactionType }),
        });
    }

    removePollCommentReaction(userId, questionAnswerId, commentId) {
        return this.request(`/users/${userId}/feed/polls/${questionAnswerId}/comments/${commentId}/reaction`, { method: "DELETE" });
    }

    getPollCommentReactors(userId, questionAnswerId, commentId, offset = 0, limit = 50) {
        const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
        return this.request(`/users/${userId}/feed/polls/${questionAnswerId}/comments/${commentId}/reactors?${params}`);
    }

    reportPollComment(userId, questionAnswerId, commentId, reason = "inappropriate") {
        return this.request(`/users/${userId}/feed/polls/${questionAnswerId}/comments/${commentId}/report`, {
            method: "POST",
            body: JSON.stringify({ reason }),
        });
    }

    deletePollComment(userId, questionAnswerId, commentId) {
        return this.request(`/users/${userId}/feed/polls/${questionAnswerId}/comments/${commentId}`, { method: "DELETE" });
    }

    setFeedActivityReaction(userId, activityId, reactionType) {
        return this.request(`/users/${userId}/feed/activities/${activityId}/reaction`, {
            method: "PUT",
            body: JSON.stringify({ reaction_type: reactionType }),
        });
    }

    removeFeedActivityReaction(userId, activityId) {
        return this.request(`/users/${userId}/feed/activities/${activityId}/reaction`, { method: "DELETE" });
    }

    getFeedActivityReactors(userId, activityId, reactionType = "") {
        const params = new URLSearchParams();
        if (reactionType) params.set("reaction_type", reactionType);
        const query = params.size ? `?${params}` : "";
        return this.request(`/users/${userId}/feed/activities/${activityId}/reactions${query}`);
    }

    listFeedActivityComments(userId, activityId, before = null, limit = 30) {
        const params = new URLSearchParams({ limit: String(limit) });
        if (before?.created_at) params.set("before_created_at", before.created_at);
        if (before?.id) params.set("before_id", String(before.id));
        return this.request(`/users/${userId}/feed/activities/${activityId}/comments?${params}`);
    }

    getFeedActivityComment(userId, activityId, commentId) {
        return this.request(`/users/${userId}/feed/activities/${activityId}/comments/${commentId}`);
    }

    listFeedActivityCommentReplies(userId, activityId, rootCommentId, after = null, limit = 50) {
        const params = new URLSearchParams({ limit: String(limit) });
        if (after?.created_at) params.set("after_created_at", after.created_at);
        if (after?.id) params.set("after_id", String(after.id));
        return this.request(`/users/${userId}/feed/activities/${activityId}/comments/${rootCommentId}/replies?${params}`);
    }

    createFeedActivityComment(userId, activityId, body, clientRequestId, parentCommentId = null) {
        return this.request(`/users/${userId}/feed/activities/${activityId}/comments`, {
            method: "POST",
            body: JSON.stringify({ body, client_request_id: clientRequestId, ...(parentCommentId ? { parent_comment_id: parentCommentId } : {}) }),
        });
    }

    setFeedActivityCommentReaction(userId, activityId, commentId, reactionType) {
        return this.request(`/users/${userId}/feed/activities/${activityId}/comments/${commentId}/reaction`, {
            method: "PUT",
            body: JSON.stringify({ reaction_type: reactionType }),
        });
    }

    removeFeedActivityCommentReaction(userId, activityId, commentId) {
        return this.request(`/users/${userId}/feed/activities/${activityId}/comments/${commentId}/reaction`, { method: "DELETE" });
    }

    getFeedActivityCommentReactors(userId, activityId, commentId, offset = 0, limit = 50) {
        const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
        return this.request(`/users/${userId}/feed/activities/${activityId}/comments/${commentId}/reactors?${params}`);
    }

    reportFeedActivityComment(userId, activityId, commentId, reason = "inappropriate") {
        return this.request(`/users/${userId}/feed/activities/${activityId}/comments/${commentId}/report`, {
            method: "POST",
            body: JSON.stringify({ reason }),
        });
    }

    deleteFeedActivityComment(userId, activityId, commentId) {
        return this.request(`/users/${userId}/feed/activities/${activityId}/comments/${commentId}`, { method: "DELETE" });
    }

    revealSender(userId, questionAnswerId) {
        return this.request(`/users/${userId}/reveals/${questionAnswerId}`, { method: "POST" });
    }

    purchaseGlobalBoost(userId) {
        return this.request(`/users/${userId}/visibility-boosts/global`, { method: "POST" });
    }

    purchaseTargetedBoost(userId, targetUserId) {
        return this.request(`/users/${userId}/visibility-boosts/targeted`, {
            method: "POST",
            body: JSON.stringify({ target_user_id: targetUserId }),
        });
    }

    reportQuestion(userId, questionId, reason = "inappropriate") {
        const params = new URLSearchParams({ reason });
        return this.request(`/users/${userId}/questions/${questionId}/report-question?${params}`, { method: "POST" });
    }

    dismissFeedQuestion(userId, questionId) {
        return this.request(`/users/${userId}/feed/questions/${questionId}/dismiss`, { method: "POST" });
    }

    blockQuestionSubmitter(userId, questionId) {
        return this.request(`/users/${userId}/questions/${questionId}/block-submitter`, { method: "POST" });
    }

    reportUser(userId, reportedUserId, reason = "inappropriate") {
        const params = new URLSearchParams({ reason });
        return this.request(`/users/${userId}/reports/users/${reportedUserId}?${params}`, { method: "POST" });
    }

    blockUser(userId, blockedUserId) {
        return this.request(`/users/${userId}/blocks/${blockedUserId}`, { method: "POST" });
    }

    getPlayQuestions(userId) {
        return this.request(`/users/${userId}/questions/unanswered`);
    }

    getConfig() {
        return this.request("/config", { auth: false });
    }

    getWebPushConfig() {
        return this.request("/web-push/config", { auth: false });
    }

    registerWebPushSubscription(userId, subscription) {
        return this.request(`/users/${userId}/web-push-subscriptions`, {
            method: "POST",
            body: JSON.stringify(subscription),
        });
    }

    deleteWebPushSubscription(userId, endpoint) {
        return this.request(`/users/${userId}/web-push-subscriptions`, {
            method: "DELETE",
            body: JSON.stringify({ endpoint }),
        });
    }

    recordStreakWarningOpen(streakWarningId) {
        return this.request("/notification-preferences/streak-warning-open", {
            method: "POST",
            body: JSON.stringify({ streak_warning_id: streakWarningId }),
        });
    }

    getClassmates(userId, search = "", limit = 500) {
        const params = new URLSearchParams({ limit: String(limit) });
        if (search.trim()) params.set("search", search.trim());
        return this.request(`/users/${userId}/classmates?${params}`);
    }

    async getClassmatesWithMetadata(userId, search = "", limit = 500) {
        const params = new URLSearchParams({ limit: String(limit) });
        if (search.trim()) params.set("search", search.trim());
        const response = await this.request(`/users/${userId}/classmates?${params}`, { includeResponseHeaders: true });
        const activeHeader = response.headers.get("x-active-classmates-this-week");
        const activeThisWeekCount = activeHeader === null ? null : Number(activeHeader);
        return {
            classmates: response.data,
            activeThisWeekCount: Number.isFinite(activeThisWeekCount) ? activeThisWeekCount : null,
        };
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
            timeoutMs: 45_000,
        });
    }

    getQuestionSubmissions(userId, limit = 100) {
        return this.request(`/users/${userId}/question-submissions?limit=${Math.min(100, Math.max(1, Number(limit) || 100))}`);
    }

    deleteQuestionSubmission(userId, submissionId) {
        return this.request(`/users/${userId}/question-submissions/${submissionId}`, { method: "DELETE" });
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

    submitFeedback(feedbackText, photo = null) {
        const formData = new FormData();
        formData.set("feedback_text", feedbackText);
        if (photo) formData.set("photo", photo);
        return this.request("/feedback", {
            method: "POST",
            body: formData,
            timeoutMs: 45_000,
        });
    }

    getFeedbackHistory(feedbackId = null) {
        const query = feedbackId
            ? `?${new URLSearchParams({ feedback_id: String(feedbackId) })}`
            : "";
        return this.request(`/feedback${query}`);
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
            timeoutMs: 45_000,
        });
    }

    getAskLink(userId) {
        return this.request(`/users/${userId}/ask-link`);
    }

    getProfileAskTarget(userId) {
        return this.request(`/users/${userId}/ask-target`);
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

    getAnonymousAskAccess(userId) {
        return this.request(`/users/${userId}/ask-sender-access`);
    }

    getAnonymousAskSafetyNotices(userId, includeAcknowledged = false) {
        const suffix = includeAcknowledged ? "?include_acknowledged=true" : "";
        return this.request(`/users/${userId}/ask-safety-notices${suffix}`);
    }

    acknowledgeAnonymousAskSafetyNotice(userId, noticeId) {
        return this.request(`/users/${userId}/ask-safety-notices/${noticeId}/acknowledge`, {
            method: "POST",
        });
    }

    createGodModeCheckout(userId) {
        return this.request(`/users/${userId}/stripe/checkout-session`, { method: "POST" });
    }

    confirmGodModeCheckout(userId, sessionId) {
        return this.request(`/users/${userId}/stripe/checkout-session/${encodeURIComponent(sessionId)}`);
    }

    unsubscribeFromGodMode(userId) {
        return this.request(`/users/${userId}/god-mode/unsubscribe`, { method: "POST" });
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

    getTbhRequestTargets(userId, search = "") {
        const params = new URLSearchParams();
        if (search.trim()) params.set("search", search.trim());
        const query = params.size ? `?${params}` : "";
        return this.request(`/users/${userId}/tbh-request-targets${query}`);
    }

    createTbhRequest(userId, recipientUserId, promptKey, idempotencyKey) {
        return this.request(`/users/${userId}/tbh-requests`, {
            method: "POST",
            body: JSON.stringify({
                recipient_user_id: recipientUserId,
                prompt_key: promptKey,
                idempotency_key: idempotencyKey,
            }),
        });
    }

    getPendingTbhRequests(userId) {
        return this.request(`/users/${userId}/tbh-requests/pending`);
    }

    openTbhRequest(userId, requestId) {
        return this.request(`/users/${userId}/tbh-requests/${requestId}/open`, { method: "POST" });
    }

    dismissTbhRequest(userId, requestId) {
        return this.request(`/users/${userId}/tbh-requests/${requestId}/dismiss`, { method: "POST" });
    }

    suppressTbhRequester(userId, requesterUserId) {
        return this.request(`/users/${userId}/tbh-suppressions/${requesterUserId}`, { method: "POST" });
    }

    respondToTbhRequest(userId, requestId, body, idempotencyKey) {
        return this.request(`/users/${userId}/tbh-requests/${requestId}/respond`, {
            method: "POST",
            body: JSON.stringify({ body, idempotency_key: idempotencyKey }),
        });
    }

    getTbhInbox(userId) {
        return this.request(`/users/${userId}/tbh-inbox`);
    }

    getSentTbhs(userId) {
        return this.request(`/users/${userId}/tbh-sent`);
    }

    getTbhSchoolFeed(userId, sort = "recent") {
        const params = new URLSearchParams({ sort });
        return this.request(`/users/${userId}/tbh-school-feed?${params}`);
    }

    getTbhResponse(userId, responseId) {
        return this.request(`/users/${userId}/tbh-responses/${responseId}`);
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

    reportAnonymousQuestion(userId, questionId, reason = "other") {
        return this.request(`/users/${userId}/anonymous-questions/${questionId}/report`, {
            method: "POST",
            body: JSON.stringify({ reason }),
        });
    }

    blockAnonymousQuestion(userId, questionId) {
        return this.request(`/users/${userId}/anonymous-questions/${questionId}/block`, { method: "POST" });
    }

    deleteAnonymousQuestion(userId, questionId) {
        return this.request(`/users/${userId}/anonymous-questions/${questionId}`, { method: "DELETE" });
    }

    getStories(userId) {
        return this.request(`/users/${userId}/stories`);
    }

    createStoryUpload(userId, { contentType, sizeBytes, thumbnailSizeBytes = null, durationMs = null, clientRequestId = crypto.randomUUID() }) {
        return this.request(`/users/${userId}/story-uploads`, {
            method: "POST",
            body: JSON.stringify({
                content_type: contentType,
                size_bytes: sizeBytes,
                thumbnail_size_bytes: thumbnailSizeBytes,
                video_duration_ms: durationMs,
                client_request_id: clientRequestId,
            }),
        });
    }

    finalizeStoryUpload(userId, mediaAssetId) {
        return this.request(`/users/${userId}/story-uploads/${mediaAssetId}/finalize`, { method: "POST", timeoutMs: 60_000 });
    }

    publishStory(userId, mediaAssetId, { caption = null, overlay = null, clientRequestId = crypto.randomUUID() } = {}) {
        const overlayText = overlay?.text?.trim() || null;
        return this.request(`/users/${userId}/stories`, {
            method: "POST",
            body: JSON.stringify({
                media_asset_id: mediaAssetId,
                client_request_id: clientRequestId,
                caption: caption?.trim() || null,
                text_overlay: overlayText,
                text_overlay_x: overlayText ? Number(overlay.x ?? 0.5) : null,
                text_overlay_y: overlayText ? Number(overlay.y ?? 0.5) : null,
            }),
        });
    }

    recordStoryView(userId, storyId) {
        return this.request(`/users/${userId}/stories/${storyId}/views`, { method: "POST" });
    }

    getStoryViewers(userId, storyId, { cursor = null, limit = 50 } = {}) {
        const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, Number(limit) || 50))) });
        if (cursor) params.set("cursor", cursor);
        return this.request(`/users/${userId}/stories/${storyId}/viewers?${params}`);
    }

    deleteStory(userId, storyId) {
        return this.request(`/users/${userId}/stories/${storyId}`, { method: "DELETE" });
    }

    reportStory(userId, storyId, reason) {
        return this.request(`/users/${userId}/stories/${storyId}/reports`, {
            method: "POST",
            body: JSON.stringify({ reason: String(reason || "").trim().slice(0, 500) }),
        });
    }

    getChats(userId, limit = 50, offset = 0) {
        const params = new URLSearchParams({
            limit: String(limit),
            offset: String(offset),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        });
        return this.request(`/users/${userId}/chats?${params}`);
    }

    getChatUnreadCount(userId) {
        return this.request(`/users/${userId}/chats-unread-count`);
    }

    createChat(userId, memberUserIds, name = null, clientRequestId = crypto.randomUUID()) {
        return this.request(`/users/${userId}/chats`, {
            method: "POST",
            body: JSON.stringify({
                member_user_ids: memberUserIds,
                name: name?.trim() || null,
                client_request_id: clientRequestId,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            }),
        });
    }

    getChat(userId, chatId) {
        const params = new URLSearchParams({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
        return this.request(`/users/${userId}/chats/${chatId}?${params}`);
    }

    acceptChatInvitation(userId, membershipId) {
        const params = new URLSearchParams({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
        return this.request(`/users/${userId}/chat-invitations/${membershipId}/accept?${params}`, { method: "POST" });
    }

    declineChatInvitation(userId, membershipId) {
        return this.request(`/users/${userId}/chat-invitations/${membershipId}/decline`, { method: "POST" });
    }

    inviteChatMembers(userId, chatId, memberUserIds, name = null) {
        return this.request(`/users/${userId}/chats/${chatId}/invitations`, {
            method: "POST",
            body: JSON.stringify({
                member_user_ids: memberUserIds,
                name: name?.trim() || null,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            }),
        });
    }

    updateChatName(userId, chatId, name) {
        return this.request(`/users/${userId}/chats/${chatId}`, {
            method: "PATCH",
            body: JSON.stringify({ name: name.trim() }),
        });
    }

    updateChatNotificationLevel(userId, chatId, notificationLevel) {
        return this.request(`/users/${userId}/chats/${chatId}/notification-settings`, {
            method: "PUT",
            body: JSON.stringify({ notification_level: notificationLevel }),
        });
    }

    uploadChatPhoto(userId, chatId, file) {
        const form = new FormData();
        form.append("file", file, "chat.jpg");
        return this.request(`/users/${userId}/chats/${chatId}/photo`, {
            method: "POST",
            body: form,
            timeoutMs: 30_000,
        });
    }

    setChatTyping(userId, chatId, isTyping) {
        return this.request(`/users/${userId}/chats/${chatId}/typing`, {
            method: "POST",
            body: JSON.stringify({ is_typing: Boolean(isTyping) }),
        });
    }

    getChatMessages(userId, chatId, { limit = 50, beforeSequence = null, afterSequence = null } = {}) {
        const params = new URLSearchParams({
            limit: String(limit),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        });
        if (beforeSequence !== null) params.set("before_sequence", String(beforeSequence));
        if (afterSequence !== null) params.set("after_sequence", String(afterSequence));
        return this.request(`/users/${userId}/chats/${chatId}/messages?${params}`);
    }

    searchChats(userId, query, limitPerType = 8) {
        return this.request(`/users/${userId}/search`, {
            method: "POST",
            body: JSON.stringify({
                q: String(query || "").trim(),
                scope: "personal",
                types: ["chats", "messages"],
                limit_per_type: Math.min(25, Math.max(1, Number(limitPerType) || 8)),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            }),
        });
    }

    sendChatMessage(userId, chatId, payload) {
        return this.request(`/users/${userId}/chats/${chatId}/messages`, {
            method: "POST",
            body: JSON.stringify({
                ...payload,
                client_request_id: payload.client_request_id || crypto.randomUUID(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            }),
        });
    }

    createChatMediaUpload(userId, { contentType, sizeBytes, thumbnailSizeBytes = null, durationMs = null, viewOnce = false, clientRequestId = crypto.randomUUID() }) {
        const payload = {
            content_type: contentType,
            size_bytes: sizeBytes,
            view_once: Boolean(viewOnce),
            client_request_id: clientRequestId,
        };
        if (thumbnailSizeBytes !== null) payload.thumbnail_size_bytes = thumbnailSizeBytes;
        if (durationMs !== null) payload.duration_ms = durationMs;
        return this.request(`/users/${userId}/chat-media-uploads`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    finalizeChatMediaUpload(userId, mediaAssetId) {
        return this.request(`/users/${userId}/chat-media-uploads/${mediaAssetId}/finalize`, {
            method: "POST",
            timeoutMs: 60_000,
        });
    }

    beginChatMediaViewSession(userId, chatId, { messageId = null, replayOfSessionId = null, clientRequestId = crypto.randomUUID() } = {}) {
        const payload = {
            client_request_id: clientRequestId,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        };
        if (messageId) payload.message_id = messageId;
        if (replayOfSessionId) payload.replay_of_session_id = replayOfSessionId;
        return this.request(`/users/${userId}/chats/${chatId}/view-once-sessions`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    startChatMediaViewSession(userId, chatId, sessionId) {
        return this.request(`/users/${userId}/chats/${chatId}/view-once-sessions/${sessionId}/started`, { method: "POST" });
    }

    getChatViewOnceReceipts(userId, chatId, messageId) {
        return this.request(`/users/${userId}/chats/${chatId}/messages/${messageId}/view-once-receipts`);
    }

    getStickers() {
        return this.request("/stickers");
    }

    setChatMessageReaction(userId, chatId, messageId, reactionType) {
        return this.request(`/users/${userId}/chats/${chatId}/messages/${messageId}/reaction`, {
            method: "PUT",
            body: JSON.stringify({
                reaction_type: reactionType || null,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            }),
        });
    }

    getChatMessageReactors(userId, chatId, messageId) {
        return this.request(`/users/${userId}/chats/${chatId}/messages/${messageId}/reactors`);
    }

    unsendChatMessage(userId, chatId, messageId) {
        return this.request(`/users/${userId}/chats/${chatId}/messages/${messageId}`, { method: "DELETE" });
    }

    deleteChatMessageForMe(userId, chatId, messageId) {
        return this.request(`/users/${userId}/chats/${chatId}/messages/${messageId}/for-me`, { method: "DELETE" });
    }

    markChatRead(userId, chatId, throughSequence) {
        return this.request(`/users/${userId}/chats/${chatId}/read`, {
            method: "POST",
            body: JSON.stringify({
                through_sequence: throughSequence,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            }),
        });
    }

    leaveChat(userId, chatId) {
        return this.request(`/users/${userId}/chats/${chatId}/leave`, { method: "POST" });
    }

    removeChatMember(userId, chatId, memberUserId) {
        return this.request(`/users/${userId}/chats/${chatId}/members/${memberUserId}`, { method: "DELETE" });
    }

    startCall(userId, chatId, mediaType, clientRequestId = crypto.randomUUID()) {
        return this.request(`/users/${userId}/chats/${chatId}/calls`, {
            method: "POST",
            body: JSON.stringify({
                client_request_id: clientRequestId,
                media_type: mediaType,
            }),
        });
    }

    getCall(userId, callId) {
        return this.request(`/users/${userId}/calls/${callId}`);
    }

    acceptCall(userId, callId) {
        return this.request(`/users/${userId}/calls/${callId}/accept`, { method: "POST" });
    }

    declineCall(userId, callId) {
        return this.request(`/users/${userId}/calls/${callId}/decline`, { method: "POST" });
    }

    joinCall(userId, callId) {
        return this.request(`/users/${userId}/calls/${callId}/join`, {
            method: "POST",
            body: JSON.stringify({ camera_slot_protocol_version: 1 }),
        });
    }

    enableCallCamera(userId, callId, clientRequestId = crypto.randomUUID()) {
        return this.request(`/users/${userId}/calls/${callId}/camera/enable`, {
            method: "POST",
            body: JSON.stringify({ client_request_id: clientRequestId }),
        });
    }

    disableCallCamera(userId, callId, reservationId) {
        return this.request(`/users/${userId}/calls/${callId}/camera/disable`, {
            method: "POST",
            body: JSON.stringify({ reservation_id: reservationId }),
        });
    }

    endCall(userId, callId, { keepalive = false } = {}) {
        return this.request(`/users/${userId}/calls/${callId}/end`, { method: "POST", keepalive });
    }

    leaveCall(userId, callId, { keepalive = false } = {}) {
        return this.request(`/users/${userId}/calls/${callId}/leave`, { method: "POST", keepalive });
    }

    reportChat(userId, chatId, reason) {
        return this.request(`/users/${userId}/chats/${chatId}/report`, {
            method: "POST",
            body: JSON.stringify({ reason }),
        });
    }

    createDailyHighlightUpload(userId, sizeBytes, clientRequestId = crypto.randomUUID()) {
        return this.request(`/users/${userId}/daily-highlight-uploads?delivery=proxy`, {
            method: "POST",
            body: JSON.stringify({
                content_type: "image/jpeg",
                size_bytes: sizeBytes,
                client_request_id: clientRequestId,
            }),
        });
    }

    async putDirectUpload(file, session, { onProgress } = {}) {
        if (session.already_finalized) return;
        await new Promise((resolve, reject) => {
            const request = new XMLHttpRequest();
            const uploadURL = new URL(session.upload_url, location.href);
            request.open(session.upload_method || "PUT", uploadURL.href, true);
            request.withCredentials = uploadURL.origin === location.origin;
            for (const [name, value] of Object.entries(session.required_headers || {})) request.setRequestHeader(name, value);
            request.upload.addEventListener("progress", (event) => {
                if (event.lengthComputable) onProgress?.(event.loaded / event.total);
            });
            request.addEventListener("load", () => {
                if (request.status >= 200 && request.status < 300) resolve();
                else reject(new APIError("The media could not be uploaded. Please try again.", request.status));
            });
            request.addEventListener("error", () => reject(new APIError("The media could not be uploaded. Check your connection.", 0)));
            request.addEventListener("abort", () => reject(new APIError("The media upload was cancelled.", 0)));
            request.send(file);
        });
    }

    finalizeDailyHighlightUpload(userId, mediaAssetId) {
        return this.request(`/users/${userId}/daily-highlight-uploads/${mediaAssetId}/finalize`, {
            method: "POST",
            timeoutMs: 60_000,
        });
    }

    publishDailyHighlight(userId, mediaAssetId, chatIds, caption = null, clientRequestId = crypto.randomUUID()) {
        return this.request(`/users/${userId}/daily-entries`, {
            method: "POST",
            body: JSON.stringify({
                media_asset_id: mediaAssetId,
                caption: caption?.trim() || null,
                chat_ids: chatIds,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                client_request_id: clientRequestId,
            }),
        });
    }

    getChatDailyRow(userId, chatId, ledgerDate = null) {
        const params = new URLSearchParams({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
        if (ledgerDate) params.set("ledger_date", ledgerDate);
        return this.request(`/users/${userId}/chats/${chatId}/daily-row?${params}`);
    }

    skipChatMemento(userId, chatId) {
        return this.request(`/users/${userId}/chats/${chatId}/daily-row/skip`, {
            method: "POST",
            body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }),
        });
    }

    chatEventsURL(userId, activeChatId = null) {
        const url = new URL(`${this.baseURL}/users/${userId}/chat-events`);
        if (activeChatId) url.searchParams.set("active_chat_id", activeChatId);
        return url.href;
    }

    requestAccountDeletion(userId) {
        return this.request(`/users/${userId}/delete`, { method: "POST" });
    }

    cancelAccountDeletion(userId) {
        return this.request(`/users/${userId}/delete/cancel`, { method: "POST" });
    }

}
