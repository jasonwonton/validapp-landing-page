import { expect, test } from "@playwright/test";

const API_ORIGIN = "https://api.six7.lol";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const CHAT_ID = "22222222-2222-2222-2222-222222222222";

test("production chat adapter matches the released iOS chat and Memento contracts", async ({ page }) => {
    await page.addInitScript((origin) => { window.VALID_API_BASE_URL = `${origin}/api/v1`; }, API_ORIGIN);
    const requests = [];
    await page.route(`${API_ORIGIN}/api/v1/**`, async (route) => {
        const request = route.request();
        requests.push({
            method: request.method(),
            path: `${new URL(request.url()).pathname}${new URL(request.url()).search}`,
            body: request.postData() ? request.postDataJSON() : null,
            authorization: request.headers().authorization,
        });
        const path = new URL(request.url()).pathname;
        const body = path.endsWith("/daily-highlight-uploads")
            ? { media_asset_id: "33333333-3333-3333-3333-333333333333", upload_url: "", upload_method: "PUT", required_headers: {}, already_finalized: true, expires_at: new Date().toISOString() }
            : path.endsWith("/messages")
            ? { id: "44444444-4444-4444-4444-444444444444", chat_id: CHAT_ID, room_sequence: 1, kind: "text", body: "Hi", status: "active", viewer_is_sender: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            : path.endsWith("/daily-row")
            ? { chat_id: CHAT_ID, ledger_date: "2026-08-27", viewer_has_posted_today: false, viewer_has_shared: false, viewer_is_eligible: true, view_gate_locked: true, posted_count: 0, eligible_count: 2, entries: [] }
            : { items: [] };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto("/app/?signin=1");
    requests.length = 0;
    await page.evaluate(async ({ userId, chatId }) => {
        const { ValidAPI } = await import("/app/api.js");
        const api = new ValidAPI();
        api.saveSession({ access_token: "chat-token", user: { id: userId } });
        await api.getChats(userId);
        await api.getChatMessages(userId, chatId, { afterSequence: 8 });
        await api.sendChatMessage(userId, chatId, { body: "Hi", client_request_id: "55555555-5555-5555-5555-555555555555" });
        await api.sendChatMessage(userId, chatId, { daily_entry_id: "77777777-7777-7777-7777-777777777777", client_request_id: "88888888-8888-8888-8888-888888888888" });
        await api.sendChatMessage(userId, chatId, { body: "Great Story", story_id: "99999999-9999-9999-9999-999999999999", story_share_context: "reply", client_request_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
        await api.getChatMessageReactors(userId, chatId, "44444444-4444-4444-4444-444444444444");
        await api.markChatRead(userId, chatId, 9);
        await api.getChatDailyRow(userId, chatId);
        await api.skipChatMemento(userId, chatId);
        await api.createDailyHighlightUpload(userId, 12345, "66666666-6666-6666-6666-666666666666");
    }, { userId: USER_ID, chatId: CHAT_ID });

    const contractRequests = requests.filter((request) => request.path !== "/api/v1/auth/session");
    expect(contractRequests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
        { method: "GET", path: `/api/v1/users/${USER_ID}/chats?limit=50&offset=0&timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`, body: null },
        { method: "GET", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages?limit=50&timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}&after_sequence=8`, body: null },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages`, body: { body: "Hi", client_request_id: "55555555-5555-5555-5555-555555555555", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages`, body: { daily_entry_id: "77777777-7777-7777-7777-777777777777", client_request_id: "88888888-8888-8888-8888-888888888888", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages`, body: { body: "Great Story", story_id: "99999999-9999-9999-9999-999999999999", story_share_context: "reply", client_request_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
        { method: "GET", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages/44444444-4444-4444-4444-444444444444/reactors`, body: null },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/read`, body: { through_sequence: 9, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
        { method: "GET", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/daily-row?timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`, body: null },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/daily-row/skip`, body: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
        { method: "POST", path: `/api/v1/users/${USER_ID}/daily-highlight-uploads?delivery=proxy`, body: { content_type: "image/jpeg", size_bytes: 12345, client_request_id: "66666666-6666-6666-6666-666666666666" } },
    ]);
    expect(contractRequests.every((request) => request.authorization === "Bearer chat-token")).toBe(true);
});

test("production chat adapter preserves invitation, membership, moderation, and notification contracts", async ({ page }) => {
    await page.addInitScript((origin) => { window.VALID_API_BASE_URL = `${origin}/api/v1`; }, API_ORIGIN);
    const requests = [];
    await page.route(`${API_ORIGIN}/api/v1/**`, async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        requests.push({ method: request.method(), path: `${url.pathname}${url.search}`, body: request.postData() ? request.postDataJSON() : null });
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: CHAT_ID, display_name: "Weekend Crew", notification_level: "muted" }) });
    });
    await page.goto("/app/?signin=1");
    requests.length = 0;
    await page.evaluate(async ({ userId, chatId }) => {
        const { ValidAPI } = await import("/app/api.js");
        const api = new ValidAPI();
        api.saveSession({ access_token: "chat-token", user: { id: userId } });
        await api.acceptChatInvitation(userId, "membership-id");
        await api.declineChatInvitation(userId, "membership-id");
        await api.updateChatNotificationLevel(userId, chatId, "muted");
        await api.setChatTyping(userId, chatId, true);
        await api.unsendChatMessage(userId, chatId, "message-id");
        await api.deleteChatMessageForMe(userId, chatId, "message-id");
        await api.removeChatMember(userId, chatId, "member-id");
        await api.reportChat(userId, chatId, "Harassment");
        await api.leaveChat(userId, chatId);
    }, { userId: USER_ID, chatId: CHAT_ID });

    const timezone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(requests).toEqual([
        { method: "POST", path: `/api/v1/users/${USER_ID}/chat-invitations/membership-id/accept?timezone=${timezone}`, body: null },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chat-invitations/membership-id/decline`, body: null },
        { method: "PUT", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/notification-settings`, body: { notification_level: "muted" } },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/typing`, body: { is_typing: true } },
        { method: "DELETE", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages/message-id`, body: null },
        { method: "DELETE", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages/message-id/for-me`, body: null },
        { method: "DELETE", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/members/member-id`, body: null },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/report`, body: { reason: "Harassment" } },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/leave`, body: null },
    ]);
});

test("production adapter matches rich media, view-once, and chat search contracts", async ({ page }) => {
    await page.addInitScript((origin) => { window.VALID_API_BASE_URL = `${origin}/api/v1`; }, API_ORIGIN);
    const requests = [];
    await page.route(`${API_ORIGIN}/api/v1/**`, async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        requests.push({ method: request.method(), path: url.pathname, body: request.postData() ? request.postDataJSON() : null });
        const payload = url.pathname.endsWith("/chat-media-uploads")
            ? { media_asset_id: "33333333-3333-3333-3333-333333333333", upload_url: "", upload_method: "PUT", required_headers: {}, expires_at: new Date().toISOString(), already_finalized: true }
            : url.pathname.endsWith("/view-once-sessions")
            ? { session_id: "77777777-7777-7777-7777-777777777777", expires_at: new Date().toISOString(), message: { id: "44444444-4444-4444-4444-444444444444", chat_id: CHAT_ID, room_sequence: 4, kind: "photo", status: "active", view_once: true, view_once_available: true, view_once_remaining_views: 2, viewer_is_sender: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } }
            : url.pathname.endsWith("/started")
            ? { session_id: "77777777-7777-7777-7777-777777777777", started_at: new Date().toISOString(), newly_started: true, message_id: "44444444-4444-4444-4444-444444444444" }
            : url.pathname.endsWith("/view-once-receipts")
            ? { message_id: "44444444-4444-4444-4444-444444444444", opened_count: 1, recipient_count: 1, members: [] }
            : url.pathname.endsWith("/search")
            ? { query: "weekend", chats: { items: [], next_cursor: null }, messages: { items: [], next_cursor: null } }
            : url.pathname.endsWith("/stickers")
            ? { stickers: [] }
            : { media_asset_id: "33333333-3333-3333-3333-333333333333", state: "ready" };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    });
    await page.goto("/app/?signin=1");
    requests.length = 0;
    await page.evaluate(async ({ userId, chatId }) => {
        const { ValidAPI } = await import("/app/api.js");
        const api = new ValidAPI();
        api.saveSession({ access_token: "chat-token", user: { id: userId } });
        await api.searchChats(userId, "weekend", 8);
        await api.createChatMediaUpload(userId, {
            contentType: "video/mp4", sizeBytes: 1024, thumbnailSizeBytes: 256,
            durationMs: 5_000, viewOnce: true,
            clientRequestId: "55555555-5555-5555-5555-555555555555",
        });
        await api.finalizeChatMediaUpload(userId, "33333333-3333-3333-3333-333333333333");
        await api.beginChatMediaViewSession(userId, chatId, {
            messageId: "44444444-4444-4444-4444-444444444444",
            clientRequestId: "66666666-6666-6666-6666-666666666666",
        });
        await api.startChatMediaViewSession(userId, chatId, "77777777-7777-7777-7777-777777777777");
        await api.getChatViewOnceReceipts(userId, chatId, "44444444-4444-4444-4444-444444444444");
        await api.getStickers();
        await api.sendChatMessage(userId, chatId, { sticker_id: "88888888-8888-8888-8888-888888888888", client_request_id: "99999999-9999-9999-9999-999999999999" });
    }, { userId: USER_ID, chatId: CHAT_ID });

    expect(requests).toEqual([
        { method: "POST", path: `/api/v1/users/${USER_ID}/search`, body: { q: "weekend", scope: "personal", types: ["chats", "messages"], limit_per_type: 8, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chat-media-uploads`, body: { content_type: "video/mp4", size_bytes: 1024, view_once: true, client_request_id: "55555555-5555-5555-5555-555555555555", thumbnail_size_bytes: 256, duration_ms: 5000 } },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chat-media-uploads/33333333-3333-3333-3333-333333333333/finalize`, body: null },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/view-once-sessions`, body: { client_request_id: "66666666-6666-6666-6666-666666666666", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, message_id: "44444444-4444-4444-4444-444444444444" } },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/view-once-sessions/77777777-7777-7777-7777-777777777777/started`, body: null },
        { method: "GET", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages/44444444-4444-4444-4444-444444444444/view-once-receipts`, body: null },
        { method: "GET", path: "/api/v1/stickers", body: null },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages`, body: { sticker_id: "88888888-8888-8888-8888-888888888888", client_request_id: "99999999-9999-9999-9999-999999999999", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
    ]);
});

test("group photo uses the released authenticated multipart endpoint", async ({ page }) => {
    await page.addInitScript((origin) => { window.VALID_API_BASE_URL = `${origin}/api/v1`; }, API_ORIGIN);
    let captured = null;
    await page.route(`${API_ORIGIN}/api/v1/users/${USER_ID}/chats/${CHAT_ID}/photo`, async (route) => {
        const request = route.request();
        captured = { method: request.method(), contentType: request.headers()["content-type"], body: request.postData() };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: CHAT_ID, display_name: "Weekend Crew" }) });
    });
    await page.goto("/app/?signin=1");
    await page.evaluate(async ({ userId, chatId }) => {
        const { ValidAPI } = await import("/app/api.js");
        const api = new ValidAPI();
        api.saveSession({ access_token: "chat-token", user: { id: userId } });
        await api.uploadChatPhoto(userId, chatId, new File([new Uint8Array([255, 216, 255, 217])], "chat.jpg", { type: "image/jpeg" }));
    }, { userId: USER_ID, chatId: CHAT_ID });
    expect(captured.method).toBe("POST");
    expect(captured.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(captured.body).toContain('name="file"; filename="chat.jpg"');
    expect(captured.body).toContain("Content-Type: image/jpeg");
});
