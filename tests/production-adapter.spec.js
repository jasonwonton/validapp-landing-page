import { expect, test } from "@playwright/test";

const API_ORIGIN = "https://api.six7.lol";
const USER_ID = "11111111-1111-1111-1111-111111111111";

async function fillProductionSignupThroughGrade(dialog) {
    await expect(dialog.getByLabel("Birthday")).toHaveCount(0);
    await dialog.locator('[data-signup-age="16"]').click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("ZIP code").fill("90210");
    await dialog.getByRole("button", { name: "Show schools" }).click();
    await dialog.getByRole("option", { name: /Westview High School/ }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("radio", { name: /Senior/ }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
}

async function fillProductionSignup(dialog) {
    await fillProductionSignupThroughGrade(dialog);
    await dialog.getByLabel("Phone number").fill("4155550123");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("First name").fill("Taylor");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Last name").fill("Jordan");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Username").fill("taylor_j");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("radio", { name: "Non-binary" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
}

test("local integration mode uses only the same-origin API proxy", async ({ page }) => {
    await page.goto("/app/?local-api=1");
    const baseURL = await page.evaluate(async () => {
        const { ValidAPI } = await import("/app/api.js");
        return new ValidAPI().baseURL;
    });
    expect(baseURL).toBe("http://127.0.0.1:4173/api/v1");
});

test("real adapter sends Ask Me safety requests with explicit report reasons", async ({ page }) => {
    const requests = [];
    await page.addInitScript((apiOrigin) => {
        window.VALID_API_BASE_URL = `${apiOrigin}/api/v1`;
    }, API_ORIGIN);
    await page.route(`${API_ORIGIN}/api/v1/**`, async (route) => {
        const request = route.request();
        requests.push({
            method: request.method(),
            path: `${new URL(request.url()).pathname}${new URL(request.url()).search}`,
            body: request.postData() ? request.postDataJSON() : null,
        });
        const status = request.url().endsWith("/acknowledge") || request.url().endsWith("/report") ? 204 : 200;
        await route.fulfill({
            status,
            contentType: "application/json",
            body: status === 204 ? "" : JSON.stringify(request.url().includes("ask-sender-access")
                ? { status: "allowed", timeout_until: null, warning_count: 0, timeout_count: 0, message: null }
                : []),
        });
    });
    await page.goto("/app/?signin=1");
    requests.length = 0;
    await page.evaluate(async ({ userId }) => {
        const { ValidAPI } = await import("/app/api.js");
        const api = new ValidAPI();
        api.saveSession({ access_token: "ask-safety-token", user: { id: userId } });
        await api.getAnonymousAskAccess(userId);
        await api.getAnonymousAskSafetyNotices(userId);
        await api.getAnonymousAskSafetyNotices(userId, true);
        await api.acknowledgeAnonymousAskSafetyNotice(userId, "notice-1");
        await api.reportAnonymousQuestion(userId, "question-1", "harassment");
    }, { userId: USER_ID });

    expect(requests).toEqual([
        { method: "GET", path: `/api/v1/users/${USER_ID}/ask-sender-access`, body: null },
        { method: "GET", path: `/api/v1/users/${USER_ID}/ask-safety-notices`, body: null },
        { method: "GET", path: `/api/v1/users/${USER_ID}/ask-safety-notices?include_acknowledged=true`, body: null },
        { method: "POST", path: `/api/v1/users/${USER_ID}/ask-safety-notices/notice-1/acknowledge`, body: null },
        { method: "POST", path: `/api/v1/users/${USER_ID}/anonymous-questions/question-1/report`, body: { reason: "harassment" } },
    ]);
});

test("real adapter sends bounded, encoded unified-search queries", async ({ page }) => {
    const urls = [];
    await page.route(`${API_ORIGIN}/api/v1/**`, async (route) => {
        urls.push(new URL(route.request().url()));
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.goto("/app/");
    await page.evaluate(async (userId) => {
        const { ValidAPI } = await import("/app/api.js");
        const api = new ValidAPI();
        api.saveSession({ access_token: "search-token", user: { id: userId } });
        await Promise.all([
            api.getClassmates(userId, "Maya Chen", 10),
            api.getPersonalFeed(userId, 0, "Maya Chen"),
            api.getSchoolFeed(userId, null, "Maya Chen"),
            api.revealSender(userId, 9001),
            api.getPasskeyStatus(),
            api.getPasskeyRegistrationChallenge(userId),
            api.registerPasskey({ userId, credentialId: "AQID", publicKey: "BAUG", attestationObject: "BwgJ", clientDataJSON: "CgsM" }),
        ]);
    }, USER_ID);
    expect(urls.map((url) => `${url.pathname}${url.search}`).sort()).toEqual([
        `/api/v1/users/${USER_ID}/classmates?limit=10&search=Maya+Chen`,
        `/api/v1/users/${USER_ID}/feed/school?limit=20&search=Maya+Chen`,
        `/api/v1/users/${USER_ID}/feed?limit=20&offset=0&search=Maya+Chen`,
        `/api/v1/users/${USER_ID}/reveals/9001`,
        "/api/v1/auth/passkey/register",
        `/api/v1/auth/passkey/register/challenge?userId=${USER_ID}`,
        "/api/v1/auth/passkey/status",
    ].sort());
});

test("real adapter uses the scoped aura boost endpoints", async ({ page }) => {
    const requests = [];
    await page.route(`${API_ORIGIN}/api/v1/**`, async (route) => {
        const request = route.request();
        requests.push({
            method: request.method(),
            path: new URL(request.url()).pathname,
            body: request.postDataJSON(),
            authorization: request.headers().authorization,
        });
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ aura_points: 100 }) });
    });
    await page.goto("/app/");
    await page.evaluate(async ({ userId, targetId }) => {
        const { ValidAPI } = await import("/app/api.js");
        const api = new ValidAPI();
        api.saveSession({ access_token: "boost-token", user: { id: userId } });
        await api.purchaseGlobalBoost(userId);
        await api.purchaseTargetedBoost(userId, targetId);
    }, { userId: USER_ID, targetId: "21111111-1111-1111-1111-111111111111" });

    expect(requests).toEqual([
        {
            method: "POST",
            path: `/api/v1/users/${USER_ID}/visibility-boosts/global`,
            body: null,
            authorization: "Bearer boost-token",
        },
        {
            method: "POST",
            path: `/api/v1/users/${USER_ID}/visibility-boosts/targeted`,
            body: { target_user_id: "21111111-1111-1111-1111-111111111111" },
            authorization: "Bearer boost-token",
        },
    ]);
});

test("real adapter does not expose an upstream HTML error page", async ({ page }) => {
    await page.addInitScript((apiOrigin) => {
        window.VALID_API_BASE_URL = `${apiOrigin}/api/v1`;
    }, API_ORIGIN);
    await page.route(`${API_ORIGIN}/api/v1/config`, async (route) => {
        await route.fulfill({
            status: 502,
            contentType: "text/html",
            body: "<!DOCTYPE html><html><body>via_upstream</body></html>",
        });
    });
    await page.goto("/app/");

    const error = await page.evaluate(async () => {
        const { ValidAPI } = await import("/app/api.js");
        try {
            await new ValidAPI().getConfig();
            return null;
        } catch (caught) {
            return { message: caught.message, status: caught.status, detail: caught.detail };
        }
    });

    expect(error).toEqual({
        message: "Valid is temporarily unavailable. Please try again in a moment.",
        status: 502,
        detail: "<!DOCTYPE html><html><body>via_upstream</body></html>",
    });
});

function profile(firstName = "Jordan", auraPoints = 500) {
    return {
        user_id: USER_ID,
        first_name: firstName,
        last_name: "Lee",
        username: firstName.toLowerCase(),
        school_id: 77,
        school_name: "Westview High School",
        grade: "Junior",
        gender: "non-binary",
        aura_points: auraPoints,
        vote_count: 4,
        current_streak: 1,
        can_change_information: true,
    };
}

async function installCredentialStub(page, operation) {
    await page.addInitScript((credentialOperation) => {
        class TestPublicKeyCredential {}
        Object.defineProperty(window, "PublicKeyCredential", { value: TestPublicKeyCredential });
        const bytes = (...values) => Uint8Array.from(values).buffer;
        const credential = {
            rawId: bytes(1, 2, 3, 4),
            response: credentialOperation === "get"
                ? {
                    authenticatorData: bytes(5, 6),
                    signature: bytes(7, 8),
                    clientDataJSON: bytes(9, 10),
                    userHandle: null,
                }
                : {
                    attestationObject: bytes(11, 12),
                    clientDataJSON: bytes(13, 14),
                    getPublicKey: () => bytes(15, 16),
                },
        };
        Object.defineProperty(Navigator.prototype, "credentials", {
            configurable: true,
            get: () => ({
                get: async () => credential,
                create: async () => credential,
            }),
        });
    }, operation);
}

async function installWebPushStub(page, { existing = true } = {}) {
    await page.addInitScript(({ hasExistingSubscription }) => {
        let currentSubscription = null;
        const subscription = {
            endpoint: "https://web.push.apple.com/test-subscription",
            options: {},
            toJSON: () => ({
                endpoint: "https://web.push.apple.com/test-subscription",
                keys: { p256dh: "browser-public-key-value", auth: "browser-auth-value" },
            }),
            unsubscribe: async () => {
                currentSubscription = null;
                return true;
            },
        };
        currentSubscription = hasExistingSubscription ? subscription : null;
        const pushManager = {
            getSubscription: async () => currentSubscription,
            subscribe: async () => {
                currentSubscription = subscription;
                return subscription;
            },
        };
        const serviceWorker = {
            ready: Promise.resolve({ pushManager }),
            register: async () => ({ pushManager }),
            addEventListener: () => {},
        };
        Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
        Object.defineProperty(window, "Notification", {
            configurable: true,
            value: { permission: "granted", requestPermission: async () => "granted" },
        });
        Object.defineProperty(Navigator.prototype, "serviceWorker", {
            configurable: true,
            get: () => serviceWorker,
        });
    }, { hasExistingSubscription: existing });
}

async function interceptProductionAPI(page, { signup = false, phoneExists = false, profileAura = 500, questionFailureCount = 0, webPushFailureCount = 0, feedLocked = false } = {}) {
    const requests = [];
    let questionAttempts = 0;
    let webPushAttempts = 0;
    await page.route(`${API_ORIGIN}/api/v1/**`, async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = `${url.pathname}${url.search}`;
        let body = null;
        if (request.postData()) {
            try { body = request.postDataJSON(); } catch { body = request.postData(); }
        }
        requests.push({
            method: request.method(),
            path,
            body,
            authorization: request.headers().authorization || null,
            contentType: request.headers()["content-type"] || null,
        });

        const fulfill = (payload, status = 200) => route.fulfill({
            status,
            contentType: "application/json",
            body: payload === null ? "" : JSON.stringify(payload),
        });

        if (path === "/api/v1/auth/passkey/authenticate/challenge") {
            return fulfill({
                challenge: "AQIDBA==",
                rpId: "six7.lol",
                allowCredentials: null,
                timeout: 60_000,
                correlationId: "contract-correlation",
            });
        }
        if (path === "/api/v1/auth/passkey/authenticate") {
            return fulfill({ access_token: "session-token", user: { id: USER_ID, subscribed_user: false } });
        }
        if (path === "/api/v1/auth/passkey/status") return fulfill({ registered: true, credentialCount: 1 });
        if (path === "/api/v1/web-push/config") {
            return fulfill({ enabled: true, vapid_public_key: "BC31fbRg792qbDNr_PaGHMhLlTjBL2VYpOkkhRS85gA1ofvBUbi0Vmixqdr3V7Exm4820s27ZpvNbcTkuTHMDKM" });
        }
        if (path === `/api/v1/users/${USER_ID}/web-push-subscriptions` && request.method() === "POST") {
            webPushAttempts += 1;
            if (webPushAttempts <= webPushFailureCount) return fulfill({ detail: "Subscription write failed" }, 500);
            return fulfill({ registered: true });
        }
        if (path === "/api/v1/users/username-available/taylor_j") return fulfill({ available: true, username: "taylor_j" });
        if (path === "/api/v1/highschools/nearby?zip_code=90210&limit=50") {
            return fulfill({
                zip_code: "90210",
                schools: [{ id: 77, name: "Westview High School", city: "Los Angeles", state: "CA", logo_url: "", member_count: 12, min_grade: 9, max_grade: 12, distance_miles: 0.8 }],
            });
        }
        if (path === "/api/v1/highschools/request") {
            return fulfill({ school: { id: 77, name: body.school_name, city: body.city, state: body.state } });
        }
        if (path === "/api/v1/auth/passkey/signup/challenge") {
            return fulfill({
                challenge: "AQIDBA==",
                userId: USER_ID,
                userName: body.username,
                rpId: "six7.lol",
                rpName: "Valid",
            });
        }
        if (path === "/api/v1/users/phone-check") {
            return fulfill({
                exists: phoneExists,
                vote_count: 6,
                status: phoneExists ? "existing_complete_account" : "available",
                has_profile: phoneExists,
            });
        }
        if (path === "/api/v1/auth/passkey/signup/complete") {
            return fulfill({ access_token: "session-token", user: { id: USER_ID, subscribed_user: false }, profile: profile("Taylor", profileAura) });
        }
        if (path === `/api/v1/users/${USER_ID}`) return fulfill({ id: USER_ID, subscribed_user: false });
        if (path === `/api/v1/users/${USER_ID}/profile`) return fulfill(profile(signup ? "Taylor" : "Jordan", profileAura));
        if (path === "/api/v1/users/21111111-1111-1111-1111-111111111111/profile") {
            return fulfill({ ...profile("Maya", 0), user_id: "21111111-1111-1111-1111-111111111111", last_name: "Chen", username: "maya_c", bio: "Student council and bad puns.", vote_count: 61 });
        }
        if (path === `/api/v1/users/${USER_ID}/classmates/status`) {
            return fulfill(feedLocked
                ? { is_unlocked: false, lock_reasons: ["votes"], votes_cast: 1, required_votes: 3 }
                : { is_unlocked: true, lock_reasons: [], votes_cast: 3, required_votes: 3 });
        }
        if (path === `/api/v1/users/${USER_ID}/feed?limit=20&offset=0`) return fulfill([]);
        if (path.startsWith(`/api/v1/users/${USER_ID}/feed?limit=20&offset=0&search=`)) return fulfill([]);
        if (path === `/api/v1/users/${USER_ID}/anonymous-inbox?limit=30&offset=0`) {
            return fulfill({ questions: [], answers: [] });
        }
        if (path === `/api/v1/users/${USER_ID}/questions/unanswered`) {
            return fulfill({ questions: [{ id: 201, question_text: "Who gives the best advice?", image_url: null }] });
        }
        if (path === `/api/v1/users/${USER_ID}/classmates?limit=500`) {
            return fulfill([
                { user_id: "21111111-1111-1111-1111-111111111111", first_name: "Maya", last_name: "Chen" },
                { user_id: "31111111-1111-1111-1111-111111111111", first_name: "Noah", last_name: "Williams" },
                { user_id: "41111111-1111-1111-1111-111111111111", first_name: "Ava", last_name: "Patel" },
                { user_id: "51111111-1111-1111-1111-111111111111", first_name: "Eli", last_name: "Brooks" },
            ]);
        }
        if (path.startsWith(`/api/v1/users/${USER_ID}/classmates?limit=10&search=`)) {
            return fulfill([{ user_id: "21111111-1111-1111-1111-111111111111", first_name: "Maya", last_name: "Chen", grade: "Senior" }]);
        }
        if (path === `/api/v1/users/${USER_ID}/invites/status`) return fulfill({ limit: 3, sent_today: 0, remaining: 3 });
        if (path === "/api/v1/config") return fulfill({
            nomination_aura_cost: 100,
            question_submission_aura_cost: 200,
            max_custom_question_length: 280,
            max_skips_per_set: 3,
            play_lock_time_seconds: 60,
        });
        if (path === `/api/v1/users/${USER_ID}/question-answers`) {
            return fulfill({ aura_points_earned: 5, total_aura_points: 55, current_streak: 1, streak_multiplier: 1 });
        }
        if (path.startsWith(`/api/v1/users/${USER_ID}/top-questions?`)) return fulfill([]);
        if (path === `/api/v1/users/${USER_ID}/ask-link`) {
            return fulfill({ share_url: "https://validapp.lol/a/contract", is_active: true });
        }
        if (path === `/api/v1/users/${USER_ID}/ask-sender-access`) {
            return fulfill({ status: "allowed", timeout_until: null, warning_count: 0, timeout_count: 0, message: null });
        }
        if (path === `/api/v1/users/${USER_ID}/ask-safety-notices`) return fulfill([]);
        if (path === `/api/v1/users/${USER_ID}/ask-safety-notices?include_acknowledged=true`) return fulfill([]);
        if (path === `/api/v1/users/${USER_ID}/question-submissions`) {
            questionAttempts += 1;
            if (questionAttempts <= questionFailureCount) return fulfill({ detail: "Temporary upstream failure" }, 500);
            return fulfill({
                id: "61111111-1111-1111-1111-111111111111",
                status: "pending",
                aura_spent: 200,
                is_duplicate: questionFailureCount > 0,
            });
        }
        if (path === "/api/v1/feedback" && request.method() === "POST") {
            return fulfill({
                id: "71111111-1111-1111-1111-111111111111",
                user_id: USER_ID,
                feedback_text: "Make the active tab easier to spot.",
                created_at: new Date().toISOString(),
                photo_url: null,
            }, 201);
        }
        if (path === `/api/v1/users/${USER_ID}/profile-picture`) return fulfill({ url: "https://cdn.example/avatar.jpg" });
        if (path === "/api/v1/auth/logout") return fulfill(null, 204);
        return fulfill({ detail: `Unexpected production-adapter request: ${request.method()} ${path}` }, 500);
    });
    return requests;
}

test("real adapter signs in, authenticates API calls, and revokes logout", async ({ page }) => {
    await installCredentialStub(page, "get");
    const requests = await interceptProductionAPI(page);

    await page.goto("/app/");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();

    const assertion = requests.find((request) => request.path === "/api/v1/auth/passkey/authenticate");
    expect(assertion.authorization).toBeNull();
    expect(assertion.body).toMatchObject({
        credentialId: "AQIDBA==",
        authenticatorData: "BQY=",
        signature: "Bwg=",
        clientDataJSON: "CQo=",
        correlationId: "contract-correlation",
    });
    const profileRequest = requests.find((request) => request.path.endsWith("/profile"));
    expect(profileRequest.authorization).toBe("Bearer session-token");

    await page.getByRole("button", { name: "Log out" }).click();
    await expect.poll(() => requests.some((request) => request.path === "/api/v1/auth/logout")).toBe(true);
    const logout = requests.find((request) => request.path === "/api/v1/auth/logout");
    expect(logout.authorization).toBe("Bearer session-token");
});

test("Settings submits authenticated multipart feedback", async ({ page }) => {
    await page.addInitScript((apiOrigin) => {
        window.VALID_API_BASE_URL = `${apiOrigin}/api/v1`;
    }, API_ORIGIN);
    await installCredentialStub(page, "get");
    const requests = await interceptProductionAPI(page);

    await page.goto("/app/?signin=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Leave feedback" }).click();
    const dialog = page.getByRole("dialog", { name: "Leave feedback" });
    await dialog.getByLabel("What should we improve?").fill("Make the active tab easier to spot.");
    await dialog.getByLabel("Add a screenshot (optional)").setInputFiles({
        name: "screen.png",
        mimeType: "image/png",
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await dialog.getByRole("button", { name: "Send feedback" }).click();

    await expect(page.locator("#toast")).toContainText("Thanks — feedback sent");
    const request = requests.find((candidate) => candidate.path === "/api/v1/feedback");
    expect(request).toMatchObject({ method: "POST", authorization: "Bearer session-token" });
    expect(request.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(request.body).toContain('name="feedback_text"');
    expect(request.body).toContain("Make the active tab easier to spot.");
    expect(request.body).toContain('filename="screen.png"');
});

test("incomplete Web Push setup stays retryable until the backend confirms registration", async ({ page }) => {
    await page.addInitScript((apiOrigin) => {
        window.VALID_API_BASE_URL = `${apiOrigin}/api/v1`;
    }, API_ORIGIN);
    await installCredentialStub(page, "get");
    await installWebPushStub(page);
    const requests = await interceptProductionAPI(page, { webPushFailureCount: 1 });

    await page.goto("/app/?signin=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();

    const notificationButton = page.locator("#notificationButton");
    await expect(notificationButton).toContainText("Setup incomplete · tap to retry");
    await notificationButton.click();
    await expect(notificationButton).toContainText("On · tap to turn off");
    expect(requests.filter((request) => request.path.endsWith("/web-push-subscriptions"))).toHaveLength(2);
});

test("locked Feed shows received votes, vote-to-unlock, and notification activation", async ({ page }) => {
    await page.addInitScript((apiOrigin) => {
        window.VALID_API_BASE_URL = `${apiOrigin}/api/v1`;
    }, API_ORIGIN);
    await installCredentialStub(page, "get");
    await installWebPushStub(page, { existing: false });
    const requests = await interceptProductionAPI(page, { feedLocked: true });

    await page.goto("/app/?signin=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();

    const gate = page.locator("#feedGateLock");
    await expect(gate.getByRole("heading", { name: "4 votes" })).toBeVisible();
    await expect(gate).toContainText("Cast 2 more votes to unlock your Feed");
    await expect(gate.getByRole("button", { name: "Vote now to unlock Feed" })).toBeVisible();
    const notificationButton = gate.getByRole("button", { name: "Enable notifications" });
    await expect(notificationButton).toBeVisible();
    await notificationButton.click();

    await expect(gate.getByLabel("Enable vote notifications")).toBeHidden();
    expect(requests.filter((request) => request.path.endsWith("/web-push-subscriptions"))).toHaveLength(1);
});

test("unified search debounces rapid typing into one bounded request pair", async ({ page }) => {
    await installCredentialStub(page, "get");
    const requests = await interceptProductionAPI(page);
    await page.goto("/app/");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
    requests.length = 0;

    await page.getByPlaceholder("Search names, questions...").pressSequentially("Maya", { delay: 25 });
    await expect.poll(() => requests.filter((request) => request.path.includes("/classmates?limit=10&search=")).length).toBe(1);
    await page.waitForTimeout(450);
    expect(requests.filter((request) => request.path.includes("/classmates?limit=10&search=")).length).toBe(1);
    expect(requests.filter((request) => request.path.includes("/feed?limit=20&offset=0&search=")).length).toBe(1);
});

test("real adapter links signup to the phone identity without an SMS request", async ({ page }) => {
    await installCredentialStub(page, "create");
    const requests = await interceptProductionAPI(page, { signup: true });

    await page.goto("/app/");
    await page.getByRole("button", { name: "Create an account" }).click();
    const dialog = page.getByRole("dialog");
    await fillProductionSignup(dialog);
    await dialog.getByLabel(/Profile photo/).setInputFiles({
        name: "avatar.png",
        mimeType: "image/png",
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();

    const challenge = requests.find((request) => request.path === "/api/v1/auth/passkey/signup/challenge");
    expect(challenge.body).toEqual({ username: "taylor_j" });
    expect(challenge.authorization).toBeNull();
    const completion = requests.find((request) => request.path === "/api/v1/auth/passkey/signup/complete");
    expect(completion.authorization).toBeNull();
    expect(completion.body).toMatchObject({
        userId: USER_ID,
        phoneNumber: "4155550123",
        credentialId: "AQIDBA==",
        attestationObject: "Cww=",
        clientDataJSON: "DQ4=",
        profile: {
            first_name: "Taylor",
            last_name: "Jordan",
            username: "taylor_j",
            gender: "non-binary",
            school_id: 77,
            grade: "Senior",
            date_of_birth: `${new Date().getFullYear() - 16}-01-01T00:00:00Z`,
        },
    });
    expect(completion.body.deviceInstallationId.length).toBeGreaterThanOrEqual(8);
    const phoneCheck = requests.find((request) => request.path === "/api/v1/users/phone-check");
    expect(phoneCheck.authorization).toBeNull();
    expect(phoneCheck.body.phone_number).toBe("4155550123");
    expect(phoneCheck.body.device_installation_id).toBe(completion.body.deviceInstallationId);
    const nearby = requests.find((request) => request.path === "/api/v1/highschools/nearby?zip_code=90210&limit=50");
    expect(nearby.authorization).toBeNull();
    expect(requests.some((request) => request.path === "/api/v1/highschools/request")).toBe(false);
    const photo = requests.find((request) => request.path.endsWith("/profile-picture"));
    expect(photo.authorization).toBe("Bearer session-token");
    expect(photo.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(requests.some((request) => /sms|phone\/(request|confirm)/i.test(request.path))).toBe(false);
});

test("signup sends existing phone identities back to sign in", async ({ page }) => {
    const requests = await interceptProductionAPI(page, { signup: true, phoneExists: true });
    await page.goto("/app/");
    await page.getByRole("button", { name: "Create an account" }).click();
    const dialog = page.getByRole("dialog");
    await fillProductionSignupThroughGrade(dialog);
    await dialog.getByLabel("Phone number").fill("4155550123");
    await dialog.getByRole("button", { name: "Continue" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator("#authStatus")).toHaveText(
        "An account already exists for this phone number. Sign in.",
    );
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeFocused();
    expect(requests.some((request) => request.path === "/api/v1/auth/passkey/signup/challenge")).toBe(false);
});

test("real adapter submits a Play vote and multipart school question", async ({ page }) => {
    await installCredentialStub(page, "get");
    const requests = await interceptProductionAPI(page);

    await page.goto("/app/");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByText("Who gives the best advice?")).toBeVisible();
    await page.locator("[data-choice]").first().click();
    await expect(page.getByRole("heading", { name: "Congrats!" })).toBeVisible();
    const vote = requests.find((request) => request.path.endsWith("/question-answers"));
    expect(vote.authorization).toBe("Bearer session-token");
    expect(vote.body).toMatchObject({
        question_id: 201,
        is_nomination: false,
    });
    expect(vote.body.selected_contact_user_id).toBeTruthy();
    expect(vote.body.presented_options).toHaveLength(4);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "View classmates" }).click();
    const directory = page.getByRole("dialog", { name: "Classmates", exact: true });
    await directory.getByRole("button", { name: /Maya Chen/ }).click();
    const classmateProfile = page.getByRole("dialog", { name: "Profile", exact: true });
    await expect(classmateProfile.getByRole("heading", { name: "Maya Chen" })).toBeVisible();
    await expect.poll(() => requests.some((request) => request.path.endsWith("21111111-1111-1111-1111-111111111111/profile"))).toBe(true);
    await classmateProfile.getByRole("button", { name: "Back to classmates" }).click();
    await directory.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: /Submit a school question/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("What should your school vote on?").fill("Who makes everyone feel included?");
    await dialog.getByLabel(/Artwork/).setInputFiles({
        name: "art.png",
        mimeType: "image/png",
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await dialog.getByLabel(/permission to use this image/i).check();
    await dialog.getByRole("button", { name: "Submit for review" }).click();
    const confirmation = page.getByRole("dialog").filter({ hasText: "Submit this poll?" });
    await expect(confirmation.getByText("200 aura", { exact: true })).toBeVisible();
    await confirmation.getByRole("button", { name: "Spend 200 aura" }).click();
    await expect.poll(() => requests.some((request) => request.path.endsWith("/question-submissions"))).toBe(true);
    await expect(dialog).toBeHidden();
    await expect(page.locator("#toast")).toContainText("Question sent for review");

    const submission = requests.find((request) => request.path.endsWith("/question-submissions"));
    expect(submission.authorization).toBe("Bearer session-token");
    expect(submission.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(String(submission.body)).toContain("Who makes everyone feel included?");
    expect(String(submission.body)).toContain("idempotency_key");
    expect(String(submission.body)).toContain("art.png");
});

test("real adapter gives rate-limited users an actionable wait time", async ({ page }) => {
    await page.route(`${API_ORIGIN}/api/v1/auth/passkey/authenticate/challenge`, (route) => route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: {
            "Retry-After": "42",
            "Access-Control-Expose-Headers": "Retry-After",
        },
        body: JSON.stringify({ detail: "Too many requests. Please try again shortly." }),
    }));

    await page.goto("/app/");
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page.locator("#authStatus")).toHaveText("Too many requests. Try again in 42 seconds.");
});

test("question submission refuses an aura overdraft before calling the API", async ({ page }) => {
    await installCredentialStub(page, "get");
    const requests = await interceptProductionAPI(page, { profileAura: 50 });
    await page.goto("/app/");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: /Submit a school question/i }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Submit a school question" });
    await dialog.getByLabel("What should your school vote on?").fill("Who makes school more welcoming?");
    await dialog.getByLabel(/Artwork/).setInputFiles({
        name: "art.png",
        mimeType: "image/png",
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await dialog.getByLabel(/permission to use this image/i).check();
    await dialog.getByRole("button", { name: "Submit for review" }).click();
    await expect(dialog.locator("#questionStatus")).toHaveText("You need 200 aura to submit this question.");
    expect(requests.filter((request) => request.path.endsWith("/question-submissions"))).toHaveLength(0);
});

test("ambiguous question retries reuse one idempotency key and never double-charge", async ({ page }) => {
    await installCredentialStub(page, "get");
    const requests = await interceptProductionAPI(page, { questionFailureCount: 1 });
    await page.goto("/app/");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: /Submit a school question/i }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Submit a school question" });
    await dialog.getByLabel("What should your school vote on?").fill("Who always makes people feel included?");
    await dialog.getByLabel(/Artwork/).setInputFiles({
        name: "art.png",
        mimeType: "image/png",
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await dialog.getByLabel(/permission to use this image/i).check();
    await dialog.getByRole("button", { name: "Submit for review" }).click();
    await page.getByRole("dialog").filter({ hasText: "Submit this poll?" })
        .getByRole("button", { name: "Spend 200 aura" }).click();
    await expect(dialog.locator("#questionStatus")).toContainText("couldn't confirm the result");
    await dialog.getByRole("button", { name: "Check submission" }).click();
    await expect(page.locator("#toast")).toContainText("Already submitted");

    const submissions = requests.filter((request) => request.path.endsWith("/question-submissions"));
    expect(submissions).toHaveLength(2);
    const key = (body) => String(body).match(/name="idempotency_key"\r\n\r\n([^\r\n]+)/)?.[1];
    expect(key(submissions[0].body)).toBeTruthy();
    expect(key(submissions[1].body)).toBe(key(submissions[0].body));
});
