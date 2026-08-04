import { expect, test } from "@playwright/test";

const API_ORIGIN = "https://api.six7.lol";
const USER_ID = "11111111-1111-1111-1111-111111111111";

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
            return fulfill({ access_token: "session-token", user: { id: USER_ID } });
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
        if (path === "/api/v1/auth/passkey/signup/complete") {
            return fulfill({ access_token: "session-token", user: { id: USER_ID }, profile: profile("Taylor", profileAura) });
        }
        if (path === `/api/v1/users/${USER_ID}/profile`) return fulfill(profile(signup ? "Taylor" : "Jordan", profileAura));
        if (path === `/api/v1/users/${USER_ID}/classmates/status`) {
            return fulfill({ is_unlocked: true, lock_reasons: [], votes_cast: 3, required_votes: 3 });
        }
        if (path === `/api/v1/users/${USER_ID}/feed?limit=20&offset=0`) return fulfill([]);
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
    await expect(page.getByText("Hey, Jordan")).toBeVisible();

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

test("real adapter completes passkey-only signup without an SMS request", async ({ page }) => {
    await installCredentialStub(page, "create");
    const requests = await interceptProductionAPI(page, { signup: true });

    await page.goto("/app/");
    await page.getByRole("button", { name: "Create an account" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("First name").fill("Taylor");
    await dialog.getByLabel("Last name").fill("Jordan");
    await dialog.getByLabel("Username").fill("taylor_j");
    await dialog.getByLabel("Birthday").fill("2008-05-12");
    await dialog.getByLabel("Gender").selectOption("non-binary");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("School name").fill("Westview High School");
    await dialog.getByLabel("City").fill("San Diego");
    await dialog.getByLabel("State").fill("CA");
    await dialog.getByLabel("Grade").selectOption("Senior");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel(/minimum age requirement/).check();
    await dialog.getByLabel(/Profile photo/).setInputFiles({
        name: "avatar.png",
        mimeType: "image/png",
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await dialog.getByRole("button", { name: "Create with passkey" }).click();
    await expect(page.getByText("Hey, Taylor")).toBeVisible();

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
    await expect(page.getByText("Hey, Jordan")).toBeVisible();

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

    await page.getByRole("button", { name: "Profile", exact: true }).click();
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
    await page.getByRole("button", { name: "Profile", exact: true }).click();
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
    await page.getByRole("button", { name: "Profile", exact: true }).click();
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
