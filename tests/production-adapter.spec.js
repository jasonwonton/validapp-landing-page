import { expect, test } from "@playwright/test";

const API_ORIGIN = "https://api.six7.lol";
const USER_ID = "11111111-1111-1111-1111-111111111111";

async function fillProductionSignup(dialog) {
    await dialog.getByLabel("School name").fill("Westview High School");
    await dialog.getByLabel("City").fill("San Diego");
    await dialog.getByLabel("State").fill("CA");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Grade").selectOption("Senior");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Birthday").fill("2008-05-12");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("First name").fill("Taylor");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Last name").fill("Jordan");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Username").fill("taylor_j");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Gender").selectOption("non-binary");
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

async function interceptProductionAPI(page, { signup = false, profileAura = 500, questionFailureCount = 0 } = {}) {
    const requests = [];
    let questionAttempts = 0;
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
        if (path === "/api/v1/users/username-available/taylor_j") return fulfill({ available: true, username: "taylor_j" });
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
        if (path === "/api/v1/auth/passkey/signup/complete") {
            return fulfill({ access_token: "session-token", user: { id: USER_ID, subscribed_user: false }, profile: profile("Taylor", profileAura) });
        }
        if (path === `/api/v1/users/${USER_ID}`) return fulfill({ id: USER_ID, subscribed_user: false });
        if (path === `/api/v1/users/${USER_ID}/profile`) return fulfill(profile(signup ? "Taylor" : "Jordan", profileAura));
        if (path === "/api/v1/users/21111111-1111-1111-1111-111111111111/profile") {
            return fulfill({ ...profile("Maya", 0), user_id: "21111111-1111-1111-1111-111111111111", last_name: "Chen", username: "maya_c", bio: "Student council and bad puns.", vote_count: 61 });
        }
        if (path === `/api/v1/users/${USER_ID}/classmates/status`) {
            return fulfill({ is_unlocked: true, lock_reasons: [], votes_cast: 3, required_votes: 3 });
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
    await page.getByRole("button", { name: /sign in with a passkey/i }).click();
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

test("unified search debounces rapid typing into one bounded request pair", async ({ page }) => {
    await installCredentialStub(page, "get");
    const requests = await interceptProductionAPI(page);
    await page.goto("/app/");
    await page.getByRole("button", { name: /sign in with a passkey/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
    requests.length = 0;

    await page.getByPlaceholder("Search names, questions...").pressSequentially("Maya", { delay: 25 });
    await expect.poll(() => requests.filter((request) => request.path.includes("/classmates?limit=10&search=")).length).toBe(1);
    await page.waitForTimeout(450);
    expect(requests.filter((request) => request.path.includes("/classmates?limit=10&search=")).length).toBe(1);
    expect(requests.filter((request) => request.path.includes("/feed?limit=20&offset=0&search=")).length).toBe(1);
});

test("real adapter completes passkey-only signup without an SMS request", async ({ page }) => {
    await installCredentialStub(page, "create");
    const requests = await interceptProductionAPI(page, { signup: true });

    await page.goto("/app/");
    await page.getByRole("button", { name: "Create an account" }).click();
    const dialog = page.getByRole("dialog");
    await fillProductionSignup(dialog);
    await dialog.getByLabel(/minimum age requirement/).check();
    await dialog.getByLabel(/Profile photo/).setInputFiles({
        name: "avatar.png",
        mimeType: "image/png",
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await dialog.getByRole("button", { name: "Create with passkey" }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();

    const challenge = requests.find((request) => request.path === "/api/v1/auth/passkey/signup/challenge");
    expect(challenge.body).toEqual({ username: "taylor_j" });
    expect(challenge.authorization).toBeNull();
    const completion = requests.find((request) => request.path === "/api/v1/auth/passkey/signup/complete");
    expect(completion.authorization).toBeNull();
    expect(completion.body).toMatchObject({
        userId: USER_ID,
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
        },
    });
    expect(completion.body.deviceInstallationId.length).toBeGreaterThanOrEqual(8);
    const photo = requests.find((request) => request.path.endsWith("/profile-picture"));
    expect(photo.authorization).toBe("Bearer session-token");
    expect(photo.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(requests.some((request) => /sms|phone\/(request|confirm)/i.test(request.path))).toBe(false);
});

test("real adapter submits a Play vote and multipart school question", async ({ page }) => {
    await installCredentialStub(page, "get");
    const requests = await interceptProductionAPI(page);

    await page.goto("/app/");
    await page.getByRole("button", { name: /sign in with a passkey/i }).click();
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
    const directory = page.getByRole("dialog").filter({ hasText: "YOUR SCHOOL" });
    await directory.getByRole("button", { name: /Maya Chen/ }).click();
    const classmateProfile = page.getByRole("dialog").filter({ hasText: "CLASSMATE PROFILE" });
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
    await page.getByRole("button", { name: /sign in with a passkey/i }).click();

    await expect(page.locator("#authStatus")).toHaveText("Too many requests. Try again in 42 seconds.");
});

test("question submission refuses an aura overdraft before calling the API", async ({ page }) => {
    await installCredentialStub(page, "get");
    const requests = await interceptProductionAPI(page, { profileAura: 50 });
    await page.goto("/app/");
    await page.getByRole("button", { name: /sign in with a passkey/i }).click();
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
    await page.getByRole("button", { name: /sign in with a passkey/i }).click();
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
