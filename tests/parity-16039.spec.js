import { expect, test } from "@playwright/test";
import { syntheticCamera } from "./fixtures/synthetic-camera.js";

async function signIn(page, extra = "") {
    await page.goto(`/app/?demo=1&signin=1&friends=1${extra}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Chats", exact: true })).toBeVisible();
}

test("Ask Me keeps a single Sent row through replies, hides recipient controls when unavailable, and opens known profiles", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1&friends=1");
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        const original = DemoAPI.prototype.getAnonymousInbox;
        DemoAPI.prototype.getAnonymousInbox = async function (...args) {
            const inbox = await original.apply(this, args);
            inbox.sent = [{ id: "sent-safe", recipient_user_id: "classmate-1", recipient_available: true, recipient_display_name: "Maya Chen", recipient_username: "maya_c", recipient_profile_picture_url: "", question_body: "What made you smile today?", answer_text: "Lunch with everyone", created_at: new Date().toISOString() }, { id: "sent-unavailable", recipient_user_id: "opaque-recipient", recipient_available: false, recipient_display_name: "SECRET RECIPIENT", recipient_username: "secret-recipient", recipient_profile_picture_url: "https://private.invalid/secret", question_body: "A past question", created_at: new Date().toISOString() }];
            inbox.answers.push({ ...inbox.sent[0], answered_at: new Date().toISOString() });
            return inbox;
        };
    });
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.locator('[data-inbox-filter="ask_me"]').click();
    await page.getByRole("button", { name: "Sent", exact: true }).click();
    await expect(page.locator('[data-anonymous-sent="sent-safe"]')).toContainText("Lunch with everyone");
    await expect(page.locator('[data-anonymous-answer="sent-safe"]')).toHaveCount(0);
    await expect(page.locator('[data-sent-recipient="sent-unavailable"]')).toHaveCount(0);
    await expect(page.locator("#feedList")).not.toContainText("SECRET RECIPIENT");
    await expect(page.locator('#feedList [src*="private.invalid"]')).toHaveCount(0);
    await page.locator('[data-sent-recipient="sent-safe"]').click();
    await expect(page.getByRole("dialog", { name: "Profile", exact: true })).toContainText("Maya Chen");
    await expect(page.getByRole("button", { name: "Chat", exact: true })).toBeVisible();
});

test("bell marks fetched activity read and follows its destination", async ({ page }) => {
    await signIn(page, "&activity=1");
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        const original = DemoAPI.prototype.markActivityRead;
        DemoAPI.prototype.markActivityRead = async function (user, payload) { window.activityReads = [...(window.activityReads || []), { user, payload }]; return original.call(this, user, payload); };
    });
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "Notifications", exact: true }).click();
    const bell = page.getByRole("dialog", { name: "Notifications", exact: true });
    await expect(bell).toContainText("Valid gifted you aura");
    await expect.poll(() => page.evaluate(() => window.activityReads?.length || 0)).toBe(1);
    expect(await page.evaluate(() => window.activityReads[0].payload.ids)).toEqual([1]);
    await bell.getByRole("button", { name: /Valid gifted you aura/ }).click();
    await expect(bell).toBeHidden();
    await expect(page.getByRole("button", { name: "Profile", exact: true })).toHaveAttribute("aria-current", "page");
});

test("a late authenticated response cannot enter a replacement account", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");
    const result = await page.evaluate(async () => {
        const { ValidAPI } = await import("/app/api.js");
        const original = window.fetch;
        let release;
        window.fetch = () => new Promise((resolve) => { release = () => resolve(new Response(JSON.stringify({ friends: [{ user_id: "private-A" }], total: 1 }), { status: 200, headers: { "Content-Type": "application/json" } })); });
        try {
            const api = new ValidAPI(); api.saveSession({ user: { id: "account-A" } });
            const pending = api.getFriends("account-A").then(() => "LEAK", (error) => error.detail.code);
            api.saveSession({ user: { id: "account-B" } }); release();
            return { result: await pending, owner: api.user.id };
        } finally { window.fetch = original; }
    });
    expect(result).toEqual({ result: "session_changed", owner: "account-B" });
});

test("age requires an explicit answer and disabled approval never starts a request", async ({ page }) => {
    await page.goto("/app/?demo=1&signup=1");
    const root = page.locator("#signupDialog");
    await root.getByRole("button", { name: "Get Started!" }).click();
    await expect(root.locator("#signupAge")).toHaveValue("");
    await expect(root.locator("#signupStatus")).toContainText("Choose your age");
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        DemoAPI.prototype.request = async (path) => { (window.parentCalls ||= []).push(path); if (path === "/parent-approvals/policy") return { enabled: false }; throw new Error("A disabled permission flow wrote to the API"); };
    });
    await root.locator('[data-signup-age="12"]').click();
    await root.getByRole("button", { name: "Get Started!" }).click();
    const permission = page.getByRole("dialog", { name: "Parent permission" });
    await expect(permission).toContainText("unavailable right now");
    expect(await page.evaluate(() => window.parentCalls)).toEqual(["/parent-approvals/policy"]);
    await permission.getByRole("button", { name: "Back to age selection" }).click();
    await expect(root).toBeVisible();
    await page.reload();
    await expect(root.locator("#signupAge")).toHaveValue("");
});

test("parent approval requires consent, offers optional monitoring, uses a fresh full-frame photo and releases the camera", async ({ page }) => {
    test.skip(!await page.evaluate(() => typeof HTMLCanvasElement.prototype.captureStream === "function"), "This browser test engine cannot create a synthetic canvas camera; physical capture remains in the device checklist.");
    await syntheticCamera(page);
    await page.goto("/app/?demo=1&signup=1");
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        DemoAPI.prototype.request = async (path, options = {}) => {
            const record = { path, method: options.method || "GET", type: options.headers?.["Content-Type"], size: options.body instanceof Blob ? options.body.size : null };
            (window.parentCalls ||= []).push(record);
            if (path === "/parent-approvals/policy") return { enabled: true, version: "fixture-notice", title: "Parent permission", account: "Account data", sharing: "Photos and messages", privacy: "Private storage", choices: "Parent choices", statement: "I am their parent and agree" };
            if (path === "/parent-approvals/request") { record.body = JSON.parse(options.body); return { status: "draft", expires_at: new Date(Date.now() + 3600_000).toISOString() }; }
            if (path === "/parent-approvals/photo") return { status: "approved" };
            throw new Error(`Unexpected parent path ${path}`);
        };
    });
    const root = page.locator("#signupDialog");
    await root.locator('[data-signup-age="12"]').click();
    await root.getByRole("button", { name: "Get Started!" }).click();
    const permission = page.getByRole("dialog", { name: "Parent permission" });
    await permission.getByRole("button", { name: "Give permission" }).click();
    await expect(permission).toContainText("must read the notice");
    await permission.getByRole("checkbox").check();
    await permission.getByRole("button", { name: "Give permission" }).click();
    await permission.getByRole("button", { name: "Skip monitoring" }).click();
    await expect(permission.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
    await permission.getByRole("button", { name: "Take photo", exact: true }).click();
    await expect(permission.getByRole("img", { name: "Your approval photo" })).toBeVisible();
    await permission.getByRole("button", { name: "Use photo" }).click();
    await expect(permission).toContainText("Permission approved");
    await permission.getByRole("button", { name: "Continue signup" }).click();
    await expect(root.getByRole("button", { name: "Choose Friends" })).toBeVisible();
    const calls = await page.evaluate(() => window.parentCalls);
    expect(calls.find((item) => item.path.endsWith("/request")).body).toMatchObject({ age: 12, consent: true, notice_version: "fixture-notice" });
    expect(calls.find((item) => item.path.endsWith("/photo"))).toMatchObject({ method: "POST", type: "image/jpeg" });
    expect(await page.evaluate(() => window.cameraStreams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended")))).toBe(true);
});

test("parent read-only view uses only its capability and never renders a composer or vote action", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");
    await page.evaluate(async () => {
        const { openParentView } = await import("/app/parent-access.js");
        const api = { request: async (path, options) => {
            (window.parentReads ||= []).push({ path, options });
            if (path.endsWith("/children")) return { children: [{ user_id: "child-1", first_name: "Taylor" }] };
            if (path.endsWith("/chats")) return { chats: [{ id: "safe-chat", name: "School friends", preview: "A visible message" }] };
            if (path.includes("/messages")) return { messages: [{ id: "safe-message", sender: "Maya", body: "Permitted text only" }], next_before: null };
            if (path.includes("/feed")) return { items: [{ question_text: "Who is kind?", voted_for_name: "Maya" }], next_timestamp: null, next_id: null };
            return {};
        } };
        openParentView({ api, token: "parentv1_fixture", escapeHTML: (text) => String(text || "").replace(/[<>&\"]/g, "") });
    });
    const parent = page.getByRole("dialog", { name: "Parent view", exact: true });
    await parent.getByRole("button", { name: /School friends/ }).click();
    await expect(parent).toContainText("Permitted text only");
    await expect(parent.getByRole("textbox")).toHaveCount(0);
    await parent.getByRole("button", { name: "Feed", exact: true }).click();
    await expect(parent).toContainText("Who is kind?");
    await expect(parent.getByRole("button", { name: /vote|send|reply/i })).toHaveCount(0);
    const reads = await page.evaluate(() => window.parentReads);
    expect(reads.every((item) => item.options.auth === false && item.options.credentials === "omit" && item.options.headers["X-Parent-Access-Token"] === "parentv1_fixture")).toBe(true);
    expect(reads.every((item) => !item.path.startsWith("/users/"))).toBe(true);
});

test("browsing a non-friend creates nothing; first-message retry keeps both request identities", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");
    await page.evaluate(async () => {
        const { openDirectDraft } = await import("/app/chat/direct-draft.js");
        window.directCalls = [];
        let attempts = 0;
        const api = {
            getDirectChat: async () => ({ state: "message", chat_id: null }),
            createChat: async (...args) => { window.directCalls.push(args); if (!attempts++) throw Object.assign(new Error("Offline"), { status: 503 }); return { id: "atomic-room" }; },
        };
        await openDirectDraft({ api, getUser: () => ({ id: "draft-owner" }), targetId: "peer", name: "Taylor", escapeHTML: (value) => String(value || ""), onOpen: async (id) => { window.directOpened = id; } });
    });
    const dialog = page.getByRole("dialog", { name: "Chat with Taylor", exact: true });
    expect(await page.evaluate(() => window.directCalls)).toEqual([]);
    await dialog.getByLabel("First message").fill("A first message");
    await dialog.getByLabel("First message").press("Enter");
    await expect(dialog.getByRole("status")).toContainText("Valid is having trouble right now");
    await expect(dialog.getByLabel("First message")).toHaveValue("A first message");
    await dialog.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(dialog).toBeHidden();
    const calls = await page.evaluate(() => window.directCalls);
    expect(calls).toHaveLength(2);
    expect(calls[0][3]).toBe(calls[1][3]);
    expect(calls[0][5]).toEqual(calls[1][5]);
    expect(calls[0][5]).toMatchObject({ body: "A first message" });
    expect(await page.evaluate(() => window.directOpened)).toBe("atomic-room");
});

test("Ask Me composer sends on Enter once and returns to Sent", async ({ page }) => {
    await signIn(page);
    await expect(page.locator('[data-inbox-count="ask_me"]')).toHaveText("1");
    const unreadBefore = await page.locator('[data-inbox-filter="ask_me"]').innerText();
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.locator('#profilePanel [data-open-friends]').click();
    const friends = page.getByRole("dialog", { name: "Add Friends", exact: true });
    await friends.getByRole("button", { name: "Friends", exact: true }).click();
    await friends.locator('[data-friend-profile="classmate-1"]').click();
    const profile = page.getByRole("dialog", { name: "Profile", exact: true });
    await profile.getByRole("button", { name: "Ask anonymously", exact: true }).click();
    const composer = page.getByRole("dialog", { name: "Ask anonymously", exact: true });
    await composer.getByLabel("Your question").fill("What made you smile today?");
    await composer.getByLabel("Your question").press("Enter");
    await expect(composer).toContainText("Message sent");
    await composer.getByRole("button", { name: "Open Sent", exact: true }).click();
    await expect(composer).toBeHidden();
    await expect(page.locator('[data-anonymous-sent]')).toHaveCount(1);
    await expect(page.locator('[data-anonymous-sent]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator('[data-anonymous-sent]')).toContainText("What made you smile today?");
    expect((await page.locator('[data-anonymous-sent]').boundingBox()).width).toBeGreaterThan(240);
    await expect(page.locator('[data-inbox-filter="ask_me"]')).toHaveText(unreadBefore);
    await expect(page.locator('#feedList .inbox-section-header')).toHaveCount(0);
});

test("parent settings, unlink decisions, withdrawal and reports stay inside the parent capability", async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => {
        const { openParentView } = await import('/app/parent-access.js');
        window.parentOperations = [];
        const rows = [{ user_id: 'teen', first_name: 'Taylor', scope: 'contacts', permission_status: 'linked', school_contacts_only: false, message_requests_from_anyone: true, activity_status_enabled: true, unlink_requested: true }, { user_id: 'young', first_name: 'Alex', scope: 'full', permission_status: 'active' }];
        const api = { request: async (path, options) => {
            window.parentOperations.push({ path, options, payload: options.body ? JSON.parse(options.body) : null });
            if (path.endsWith('/children')) return { children: structuredClone(rows) };
            if (path.endsWith('/chats')) return { chats: [] };
            if (path.includes('/feed?')) return { items: [{ question_answer_id: 55, question_text: 'Who is kind?' }], next_timestamp: null, next_id: null };
            if (path.endsWith('/friend-reach')) { rows[0].school_contacts_only = true; return { school_contacts_only: true }; }
            if (path.endsWith('/unlink')) { rows[0].unlink_requested = false; return { unlinked: false }; }
            if (path.endsWith('/withdraw')) { rows[1].permission_status = 'withdrawn'; return { withdrawn: true }; }
            if (path.endsWith('/reports')) return {};
            if (path.startsWith('/parent-links/notice?')) return { title: 'What Valid collects', sections: [{ title: 'Contacts', body: 'Phone numbers only when contacts are allowed.' }] };
            throw new Error(`Unexpected parent endpoint ${path}`);
        } };
        openParentView({ api, token: 'parentv1_fixture', escapeHTML: text => String(text || '').replace(/[<>&"]/g, '') });
    });
    const parent = page.getByRole('dialog', { name: 'Parent view', exact: true });
    await parent.getByRole('button', { name: 'Settings', exact: true }).click();
    await parent.getByRole('button', { name: /Who can add them/ }).click();
    await parent.getByRole('radio', { name: /^School & contacts/ }).check();
    await expect(parent.getByRole('radio', { name: /^School & contacts/ })).toBeEnabled();
    await parent.getByRole('button', { name: 'Back to settings', exact: true }).click();
    await parent.getByRole('button', { name: 'Parent view options', exact: true }).click();
    await parent.getByRole('button', { name: 'What Valid collects', exact: true }).click();
    await expect(parent).toContainText('Phone numbers only when contacts are allowed');
    await parent.getByRole('button', { name: 'Back to settings', exact: true }).click();
    await parent.getByRole('button', { name: 'Keep sharing', exact: true }).click();
    await page.locator('.ui-sheet').getByRole('button', { name: 'Keep sharing', exact: true }).click();
    await expect(parent).not.toContainText('Your child asked to stop sharing');
    await parent.getByRole('button', { name: 'Feed', exact: true }).click();
    await parent.getByRole('button', { name: 'Report safety issue', exact: true }).click();
    await parent.getByRole('combobox', { name: 'Reason', exact: true }).selectOption('bullying');
    await parent.getByRole('textbox', { name: 'Additional information', exact: true }).fill('Fixture safety concern');
    await parent.getByRole('button', { name: 'Submit safety report', exact: true }).click();
    await expect(parent).toContainText('Report sent');
    await parent.getByRole('combobox', { name: 'Child', exact: true }).selectOption('young');
    await parent.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(parent.locator('[data-parent-privacy]')).toHaveCount(0);
    await parent.getByRole('button', { name: 'Parent view options', exact: true }).click();
    await parent.getByRole('button', { name: 'Parent permission', exact: true }).click();
    await parent.getByRole('checkbox', { name: 'Also request deletion of the account and personal information', exact: true }).check();
    await parent.getByRole('button', { name: 'Withdraw permission', exact: true }).click();
    await expect(page.locator('.ui-sheet')).toContainText('cannot be undone');
    expect(await page.evaluate(() => window.parentOperations.filter(row => row.path.endsWith('/withdraw')))).toEqual([]);
    await page.locator('.ui-sheet').getByRole('button', { name: 'Withdraw permission', exact: true }).click();
    await expect(parent.getByRole('button', { name: 'Withdraw permission', exact: true })).toBeDisabled();
    const operations = await page.evaluate(() => window.parentOperations);
    expect(operations.find(row => row.path.endsWith('/friend-reach'))).toMatchObject({ path: '/parent-access/children/teen/friend-reach', payload: { school_contacts_only: true }, options: { method: 'PUT' } });
    expect(operations.find(row => row.path.endsWith('/reports'))).toMatchObject({ payload: { kind: 'feed_item', item_id: '55', reason: 'bullying', note: 'Fixture safety concern' } });
    expect(operations.find(row => row.path.endsWith('/withdraw'))).toMatchObject({ path: '/parent-access/children/young/withdraw', payload: { request_deletion: true } });
    expect(operations.every(row => row.options.auth === false && row.options.credentials === 'omit' && row.options.headers['X-Parent-Access-Token'] === 'parentv1_fixture')).toBe(true);
});

test("denied parent camera can retry; closing stops a late permission result", async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => {
        const { openParentApproval } = await import('/app/parent-approval.js');
        let attempt = 0;
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
            if (!attempt++) throw Object.assign(new Error('Denied'), { name: 'NotAllowedError' });
            return new Promise(resolve => { window.releaseParentCamera = () => resolve({ getTracks: () => [{ stop: () => { window.lateCameraStopped = true; } }] }); });
        } } });
        const api = { request: async path => path.endsWith('/policy') ? { enabled: true, version: 'fixture', statement: 'Parent consent' } : { status: 'draft', expires_at: new Date(Date.now() + 3600000).toISOString() } };
        void openParentApproval({ api, age: 12, deviceId: 'fixture-device', escapeHTML: text => String(text || '') }).then(result => { window.parentResult = result; });
    });
    const parent = page.getByRole('dialog', { name: 'Parent permission', exact: true });
    await parent.getByRole('checkbox').check();
    await parent.getByRole('button', { name: 'Give permission', exact: true }).click();
    await parent.getByRole('button', { name: 'Skip monitoring', exact: true }).click();
    await expect(parent).toContainText('Camera access was denied');
    await parent.getByRole('button', { name: 'Try camera again', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.releaseParentCamera)).toBe('function');
    await parent.getByRole('button', { name: 'Back to age selection', exact: true }).click();
    await expect(parent).toBeHidden();
    await page.evaluate(() => window.releaseParentCamera());
    await expect.poll(() => page.evaluate(() => window.lateCameraStopped)).toBe(true);
    expect(await page.evaluate(() => window.parentResult)).toBeNull();
});

test('parent SMS enforces the resend time, preserves failed codes and can change numbers', async ({ page }) => {
    await page.clock.install({ time: new Date('2030-03-05T12:00:00') });
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => {
        const { openParentApproval } = await import('/app/parent-approval.js');
        window.parentPhoneRequests = [];
        const api = { request: async (path, options = {}) => {
            if (path.endsWith('/policy')) return { enabled: true, version: 'fixture', statement: 'Parent consent' };
            if (path.endsWith('/phone/request')) { window.parentPhoneRequests.push(JSON.parse(options.body)); return { resend_available_at: new Date(Date.now() + 1000).toISOString() }; }
            if (path.endsWith('/phone/confirm')) throw Object.assign(new Error('Invalid or expired code'), { status: 400 });
            return { status: 'draft', expires_at: new Date(Date.now() + 3600000).toISOString() };
        } };
        void openParentApproval({ api, age: 12, deviceId: 'fixture-device', escapeHTML: text => String(text || '') });
    });
    const parent = page.getByRole('dialog', { name: 'Parent permission', exact: true });
    await parent.getByRole('checkbox').check(); await parent.getByRole('button', { name: 'Give permission', exact: true }).click();
    await parent.getByRole('textbox', { name: /phone number/ }).fill('2025550123');
    await parent.getByRole('button', { name: 'Send parent code', exact: true }).click();
    await expect(parent.locator('[data-parent-resend]')).toBeDisabled();
    await parent.getByRole('textbox', { name: 'Parent code', exact: true }).fill('1234');
    await parent.getByRole('button', { name: 'Verify parent code', exact: true }).click();
    await expect(parent).toContainText('Invalid or expired code');
    await expect(parent.getByRole('textbox', { name: 'Parent code', exact: true })).toHaveValue('1234');
    await page.clock.fastForward(1100);
    await parent.getByRole('button', { name: 'Resend Code', exact: true }).click();
    expect(await page.evaluate(() => window.parentPhoneRequests)).toEqual([{ phone_number: '2025550123' }, { phone_number: '2025550123' }]);
    await parent.getByRole('button', { name: 'Use another number', exact: true }).click();
    await expect(parent.getByRole('textbox', { name: /phone number/ })).toHaveValue('');
    await parent.getByRole('button', { name: 'Back to age selection', exact: true }).click();
});

test('optional parent link requires acknowledgment and uses the request-to-unlink journey', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => {
        const { openParentLink } = await import('/app/parent-access.js');
        window.childParentCalls = [];
        let state = { can_link: true, monitoring: false };
        const api = { request: async (path, options = {}) => {
            window.childParentCalls.push({ path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
            if (path.endsWith('/my-status')) return state;
            if (path.endsWith('/phone/request')) return { resend_available_at: new Date(Date.now() + 30000).toISOString() };
            if (path.endsWith('/phone/confirm')) return state = { monitoring: true, phone_last4: '0123', unlink_requested: false };
            if (path.endsWith('/unlink-request')) return state = { ...state, unlink_requested: options.method !== 'DELETE' };
            throw new Error('Unexpected parent-link route');
        } };
        await openParentLink({ api, getUser: () => ({ id: 'child' }), escapeHTML: text => String(text || '') });
    });
    const parent = page.getByRole('dialog', { name: 'Parent access', exact: true });
    await parent.getByRole('textbox', { name: 'Parent phone number', exact: true }).fill('2025550123');
    await parent.getByRole('button', { name: 'Send parent code', exact: true }).click();
    await expect(parent.getByRole('textbox', { name: 'Parent phone number', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.childParentCalls.filter(row => row.path.endsWith('/phone/request')))).toEqual([]);
    await parent.getByRole('checkbox').check(); await parent.getByRole('button', { name: 'Send parent code', exact: true }).click();
    await expect(parent.locator('[data-parent-link-resend]')).toBeDisabled();
    await parent.getByRole('textbox', { name: 'Parent code', exact: true }).fill('1234');
    await parent.getByRole('button', { name: 'Verify and link parent', exact: true }).click();
    await expect(parent).toContainText('ending 0123');
    await parent.getByRole('button', { name: 'Ask parent to unlink', exact: true }).click();
    await expect(parent).toContainText('Waiting for your parent to approve');
    await parent.getByRole('button', { name: 'Cancel unlink request', exact: true }).click();
    await expect(parent.getByRole('button', { name: 'Ask parent to unlink', exact: true })).toBeVisible();
    const calls = await page.evaluate(() => window.childParentCalls);
    expect(calls.find(row => row.path.endsWith('/phone/confirm')).body).toEqual({ phone_number: '2025550123', code: '1234', monitoring_acknowledged: true });
    expect(calls.filter(row => row.path.endsWith('/unlink-request')).map(row => row.method)).toEqual(['POST', 'DELETE']);
    expect(calls.some(row => row.path === '/parent-links')).toBe(false);
});
