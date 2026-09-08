import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createServer } from 'node:http';

const API_ORIGIN = "https://api.six7.lol";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const CHAT_ID = "22222222-2222-2222-2222-222222222222";

test('signed chat storage PUT is allowed by both CSPs and sends no app credentials', async ({ page, browserName }) => {
    // Real browser XHR + CSP, fixture storage response. This does NOT certify
    // production R2 CORS, which has a separate live preflight release gate.
    const host = 'https://9472d27fa2e1a3762bd91728bb7d9437.r2.cloudflarestorage.com';
    const policy = (await readFile(new URL('../_headers', import.meta.url), 'utf8')).split('\n').find(line => line.trim().startsWith('Content-Security-Policy:')).trim().slice('Content-Security-Policy:'.length).trim();
    const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
    expect(html).toContain(`connect-src 'self' ${host}`);
    await page.route('**/app/', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } });
    });
    const uploads = [];
    await page.route(`${host}/**`, async route => {
        uploads.push({ method: route.request().method(), headers: await route.request().allHeaders() });
        await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto('/app/');
    const result = await page.evaluate(async host => {
        const { ValidAPI } = await import('/app/api.js');
        const bytes = [], credentials = [], violations = [];
        document.addEventListener('securitypolicyviolation', event => violations.push(event.violatedDirective));
        const send = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(body) { bytes.push(body.size); credentials.push(this.withCredentials); return send.call(this, body); };
        for (const [name, type] of [['photo', 'image/jpeg'], ['voice', 'audio/mp4'], ['thumbnail', 'image/jpeg']]) {
            await new ValidAPI().putDirectUpload(new Blob([name], { type }), {
                upload_url: `${host}/six7-private-media/fixture/${name}?X-Amz-Signature=fixture`,
                required_headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=900' },
            });
        }
        return { bytes, credentials, violations };
    }, host);
    expect(result).toEqual({ bytes: [5, 5, 9], credentials: [false, false, false], violations: [] });
    expect(uploads).toHaveLength(3);
    for (const upload of uploads) {
        expect(upload.method).toBe('PUT');
        // WebKit's routing disables cache and rewrites this header. Verify the
        // actual un-intercepted transport separately below, not a routed mock.
        if (browserName !== 'webkit') expect(upload.headers['cache-control']).toBe('private, max-age=900');
        expect(upload.headers.authorization).toBeUndefined();
        expect(upload.headers.cookie).toBeUndefined();
    }
});

test('unintercepted upload transport preserves signed headers and exact bytes', async ({ page }) => {
    const uploads = [];
    const sources = new Map(await Promise.all(['api.js', 'auth-reliability.js', 'auth-diagnostics.js'].map(async name => [`/app/${name}`, await readFile(new URL(`../app/${name}`, import.meta.url))])));
    const server = createServer(async (request, response) => {
        if (sources.has(request.url)) { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(sources.get(request.url)); return; }
        if (request.method === 'PUT') {
            const chunks = []; for await (const chunk of request) chunks.push(chunk);
            uploads.push({ headers: request.headers, body: Buffer.concat(chunks).toString() });
            response.writeHead(204); response.end(); return;
        }
        response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>Upload transport fixture</title>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(async () => {
            const { ValidAPI } = await import('/app/api.js');
            await new ValidAPI().putDirectUpload(new Blob(['photo bytes'], { type: 'image/jpeg' }), {
                upload_url: '/upload', required_headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=900' },
            });
        });
        expect(uploads).toHaveLength(1);
        expect(uploads[0].body).toBe('photo bytes');
        expect(uploads[0].headers['content-type']).toBe('image/jpeg');
        expect(uploads[0].headers['cache-control']).toBe('private, max-age=900');
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('both Memento photos upload through real XHR under the production CSP', async ({ page }) => {
    const policy = (await readFile(new URL('../_headers', import.meta.url), 'utf8')).split('\n').find(line => line.trim().startsWith('Content-Security-Policy:')).trim().slice('Content-Security-Policy:'.length).trim();
    await page.route('**/app/', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } });
    });
    const requests = [];
    const mediaId = '33333333-3333-3333-3333-333333333333';
    const contentPath = `/api/v1/users/${USER_ID}/daily-highlight-uploads/${mediaId}/content`;
    await page.route('**/api/v1/**', async route => {
        const request = route.request(), url = new URL(request.url());
        requests.push({ method: request.method(), path: url.pathname + url.search });
        if (request.method() === 'PUT') return route.fulfill({ status: 204 });
        const body = url.pathname.endsWith('/daily-highlight-uploads')
            ? { media_asset_id: mediaId, upload_url: contentPath, secondary_upload_url: `${contentPath}?variant=secondary`, required_headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=900' }, already_finalized: false }
            : url.pathname.endsWith('/finalize') ? { media_asset_id: mediaId, state: 'ready' } : { entry_id: 'one-entry' };
        await route.fulfill({ json: body });
    });
    await page.goto('/app/');
    const sentBytes = await page.evaluate(async ({ userId, chatId }) => {
        // WebKit routing does not expose File request bodies. Observe the body
        // at send while still exercising the real browser XHR and CSP.
        const sentBytes = [];
        const send = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (body) {
            if (body instanceof Blob) sentBytes.push(body.size);
            return send.call(this, body);
        };
        const { ValidAPI } = await import('/app/api.js');
        const { deliverMementoRecord } = await import('/app/chat/index.js');
        await deliverMementoRecord(new ValidAPI(), userId, {
            file: new File(['primary'], 'primary.jpg', { type: 'image/jpeg' }),
            secondary: new File(['secondary'], 'secondary.jpg', { type: 'image/jpeg' }),
            request_id: '66666666-6666-6666-6666-666666666666', chat_ids: [chatId], caption: null,
        });
        return sentBytes;
    }, { userId: USER_ID, chatId: CHAT_ID });
    expect(requests.filter(r => r.method === 'PUT')).toEqual([
        { method: 'PUT', path: contentPath },
        { method: 'PUT', path: `${contentPath}?variant=secondary` },
    ]);
    expect(sentBytes).toEqual([7, 9]);
    expect(requests.filter(r => r.path.endsWith('/finalize'))).toHaveLength(1);
    expect(requests.filter(r => r.path.endsWith('/daily-entries'))).toHaveLength(1);
});

test('a stalled media XHR times out with a retryable error', async ({ page }) => {
    await page.goto('/app/');
    const result = await page.evaluate(async () => {
        const { ValidAPI } = await import('/app/api.js');
        let timeoutMs;
        window.XMLHttpRequest = class {
            listeners = {};
            upload = { addEventListener() {} };
            open() {}
            setRequestHeader() {}
            addEventListener(name, handler) { this.listeners[name] = handler; }
            send() { timeoutMs = this.timeout; queueMicrotask(() => this.listeners.timeout()); }
        };
        try { await new ValidAPI().putDirectUpload(new Blob(['photo']), { upload_url: '/api/v1/upload' }); }
        catch (error) { return { timeoutMs, message: error.message, status: error.status }; }
    });
    expect(result).toMatchObject({ timeoutMs: 60000, status: 0 });
    expect(result.message).toContain('timed out');
});

test("dual-view Memento delivery uploads both composites before one finalize and publish", async ({ page }) => {
    await page.goto("/app/");
    const result = await page.evaluate(async ({ userId, chatId }) => {
        const { deliverMementoRecord } = await import("/app/chat/index.js");
        const calls = [];
        const progress = [];
        const api = {
            async createDailyHighlightUpload(...args) {
                calls.push(["create", ...args]);
                return { media_asset_id: "media-dual", upload_url: "https://uploads.example/primary", secondary_upload_url: "https://uploads.example/secondary", upload_method: "PUT", required_headers: { "x-upload-token": "same-session" }, already_finalized: false };
            },
            async putDirectUpload(file, session, options) {
                calls.push(["upload", file.name, file.size, session.upload_url, session.upload_method, session.required_headers]);
                options.onProgress(0.5);
                options.onProgress(1);
            },
            async finalizeDailyHighlightUpload(...args) { calls.push(["finalize", ...args]); },
            async publishDailyHighlight(...args) { calls.push(["publish", ...args]); return { entry_id: "entry-dual" }; },
        };
        const published = await deliverMementoRecord(api, userId, {
            file: new File(["primary"], "memento.jpg", { type: "image/jpeg" }),
            secondary: new File(["secondary"], "memento-swapped.jpg", { type: "image/jpeg" }),
            request_id: "stable-request-id",
            chat_ids: [chatId],
            caption: "Both views",
        }, { onProgress: (value) => progress.push(value) });
        return { calls, progress, published };
    }, { userId: USER_ID, chatId: CHAT_ID });

    expect(result.calls).toEqual([
        ["create", USER_ID, 7, "stable-request-id", 9],
        ["upload", "memento.jpg", 7, "https://uploads.example/primary", "PUT", { "x-upload-token": "same-session" }],
        ["upload", "memento-swapped.jpg", 9, "https://uploads.example/secondary", "PUT", { "x-upload-token": "same-session" }],
        ["finalize", USER_ID, "media-dual"],
        ["publish", USER_ID, "media-dual", [CHAT_ID], "Both views", "stable-request-id"],
    ]);
    expect(result.progress).toEqual([0.24, 0.48, 0.72, 0.96, 1]);
    expect(result.published).toEqual({ entry_id: "entry-dual" });
});

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
    const invalidAudience = await page.evaluate(async ({ userId, chatId }) => {
        const { ValidAPI } = await import("/app/api.js");
        const api = new ValidAPI();
        api.saveSession({ access_token: "chat-token", user: { id: userId } });
        await api.getChats(userId);
        await api.getChatMessages(userId, chatId, { afterSequence: 8 });
        await api.sendChatMessage(userId, chatId, { body: "Hi", client_request_id: "55555555-5555-5555-5555-555555555555" });
        await api.sendChatMessage(userId, chatId, { body: "Throwback", daily_entry_id: "77777777-7777-7777-7777-777777777777", client_request_id: "88888888-8888-8888-8888-888888888888" });
        await api.sendChatMessage(userId, chatId, { daily_entry_id: "77777777-7777-7777-7777-777777777777", client_request_id: "12121212-1212-1212-1212-121212121212" });
        await api.sendChatMessage(userId, chatId, { body: "Great Story", story_id: "99999999-9999-9999-9999-999999999999", story_share_context: "reply", client_request_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
        await api.getChatMessageReactors(userId, chatId, "44444444-4444-4444-4444-444444444444");
        await api.markChatRead(userId, chatId, 9);
        await api.getChatDailyRow(userId, chatId);
        await api.skipChatMemento(userId, chatId);
        await api.createDailyHighlightUpload(userId, 12345, "66666666-6666-6666-6666-666666666666", 54321);
        await api.publishDailyHighlight(userId, "33333333-3333-3333-3333-333333333333", [chatId], "Today", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
        try {
            await api.publishDailyHighlight(userId, "33333333-3333-3333-3333-333333333333", [chatId, "99999999-9999-9999-9999-999999999999"], "Too broad");
            return null;
        } catch (error) {
            return { message: error.message, status: error.status };
        }
    }, { userId: USER_ID, chatId: CHAT_ID });

    const contractRequests = requests.filter((request) => request.path !== "/api/v1/auth/session");
    expect(invalidAudience).toEqual({ message: "A Memento must be shared to exactly one chat.", status: 400 });
    expect(contractRequests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
        { method: "GET", path: `/api/v1/users/${USER_ID}/chats?limit=50&offset=0&timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`, body: null },
        { method: "GET", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages?limit=50&timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}&after_sequence=8`, body: null },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages`, body: { body: "Hi", client_request_id: "55555555-5555-5555-5555-555555555555", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages`, body: { body: "Throwback", daily_entry_id: "77777777-7777-7777-7777-777777777777", client_request_id: "88888888-8888-8888-8888-888888888888", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages`, body: { daily_entry_id: "77777777-7777-7777-7777-777777777777", client_request_id: "12121212-1212-1212-1212-121212121212", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages`, body: { body: "Great Story", story_id: "99999999-9999-9999-9999-999999999999", story_share_context: "reply", client_request_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
        { method: "GET", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/messages/44444444-4444-4444-4444-444444444444/reactors`, body: null },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/read`, body: { through_sequence: 9, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
        { method: "GET", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/daily-row?timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`, body: null },
        { method: "POST", path: `/api/v1/users/${USER_ID}/chats/${CHAT_ID}/daily-row/skip`, body: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
        { method: "POST", path: `/api/v1/users/${USER_ID}/daily-highlight-uploads?delivery=proxy`, body: { content_type: "image/jpeg", size_bytes: 12345, client_request_id: "66666666-6666-6666-6666-666666666666", secondary_size_bytes: 54321 } },
        { method: "POST", path: `/api/v1/users/${USER_ID}/daily-entries`, body: { media_asset_id: "33333333-3333-3333-3333-333333333333", caption: "Today", chat_ids: [CHAT_ID], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, client_request_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" } },
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
    const contractRequests = requests.filter((request) => request.path !== "/api/v1/auth/session");
    expect(contractRequests).toEqual([
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
            : url.pathname.endsWith("/camera-filters/featured")
            ? { filters: [] }
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
        await api.getFeaturedCameraFilters();
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
        { method: "GET", path: "/api/v1/camera-filters/featured", body: null },
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

test("sticker creation and deletion use the released authenticated library endpoints", async ({ page }) => {
    await page.addInitScript((origin) => { window.VALID_API_BASE_URL = `${origin}/api/v1`; }, API_ORIGIN);
    const captured = [];
    await page.route(`${API_ORIGIN}/api/v1/stickers**`, async (route) => {
        const request = route.request();
        captured.push({
            method: request.method(),
            path: new URL(request.url()).pathname,
            contentType: request.headers()["content-type"] || "",
            body: request.postData() || "",
        });
        if (request.method() === "DELETE") return route.fulfill({ status: 204, body: "" });
        return route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({
                id: "88888888-8888-4888-8888-888888888888",
                image_url: "https://media.example/sticker.png",
                pixel_width: 128,
                pixel_height: 128,
                created_at: new Date().toISOString(),
            }),
        });
    });
    await page.goto("/app/?signin=1");
    await page.evaluate(async () => {
        const { ValidAPI } = await import("/app/api.js");
        const api = new ValidAPI();
        api.saveSession({ access_token: "chat-token", user: { id: "user-id" } });
        const png = new File([
            new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        ], "sticker.png", { type: "image/png" });
        const sticker = await api.createSticker(png);
        await api.deleteSticker(sticker.id);
    });

    expect(captured).toHaveLength(2);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].path).toBe("/api/v1/stickers");
    expect(captured[0].contentType).toContain("multipart/form-data; boundary=");
    expect(captured[0].body).toContain('name="image"; filename="sticker.png"');
    expect(captured[0].body).toContain("Content-Type: image/png");
    expect(captured[1]).toEqual(expect.objectContaining({
        method: "DELETE",
        path: "/api/v1/stickers/88888888-8888-4888-8888-888888888888",
    }));
});
