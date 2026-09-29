import { expect, test } from "@playwright/test";

async function signInWithStories(page, query = "") {
    await page.goto(`/app/?demo=1&signin=1&stories=1${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("region", { name: "Stories" })).toBeVisible({ timeout: 20_000 });
}

// Stop the fake clock (installed before navigation) so Story timers only move
// when a test advances them.
async function freezeClock(page) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
        } catch (error) {
            // A slow engine can pass the target before the pause lands; aim again.
            if (attempt >= 4 || !/past/.test(error.message)) throw error;
        }
    }
}

async function storyProgress(viewer) {
    return Number(await viewer.locator(".story-progress").getAttribute("data-progress"));
}

async function routeDemoVideo(page) {
    await page.route("**/assets/demo.mp4", (route) => route.fulfill({ path: "tests/fixtures/view-once.mp4", contentType: "video/mp4" }));
}

async function stagePoint(viewer, fx, fy = 0.5) {
    const box = await viewer.locator(".story-stage").boundingBox();
    return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function drag(page, from, to, { steps = 8, settleMs = 250 } = {}) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= steps; step += 1) {
        await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps);
        await page.waitForTimeout(16);
    }
    // Hold still before lifting so the release is a drag, not a flick.
    await page.waitForTimeout(settleMs);
}

async function stageOffset(viewer) {
    return viewer.locator(".story-stage").evaluate((node) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
        return { x: matrix.m41, y: matrix.m42 };
    });
}

test("native Stories can stay enabled while the independent web surface remains dark", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1&native-stories=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("region", { name: "Stories" })).toHaveCount(0);
});

for (const unavailable of [false, true]) {
    test(`Add Story remains available with an ${unavailable ? "unavailable" : "empty"} feed`, async ({ page }) => {
        await page.goto("/app/?demo=1&signin=1&stories=1");
        await page.evaluate(async (unavailable) => {
            const { DemoAPI } = await import('/app/demo-api.js');
            DemoAPI.prototype.getStories = async () => {
                if (unavailable) throw new Error('Story feed temporarily unavailable');
                return { authors: [] };
            };
        }, unavailable);
        await page.getByRole('button', { name: /^sign in$/i }).click();
        const stories = page.getByRole('region', { name: 'Stories' });
        await expect(stories).toBeVisible();
        if (unavailable) await expect(stories).toContainText('Story feed temporarily unavailable');
        else await expect(stories.locator('.stories-status')).toHaveText('');
        await expect(stories.locator('[data-story-author]')).toHaveCount(0);
        await stories.getByRole('button', { name: 'Add Story' }).click();
        const composer = page.getByRole('dialog', { name: 'Create Story' });
        await expect(composer).toBeVisible();
        await expect(composer.getByRole('button', { name: 'Post Story' })).toBeDisabled();
        await composer.getByRole('button', { name: 'Cancel' }).click();
        await expect(composer).toBeHidden();
        await expect(stories.getByRole('button', { name: 'Add Story' })).toBeVisible();
    });
}

test("Story rail reveals signed media before recording the authoritative view", async ({ page }) => {
    await page.clock.install();
    await signInWithStories(page);
    await freezeClock(page);
    const noah = page.getByRole("button", { name: "Noah Williams's Story, new" });
    await expect(noah).toHaveClass(/unviewed/);
    await noah.click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole("img", { name: "Noah Williams's Story" })).toBeVisible();
    await expect(viewer).toContainText("Game night");
    await expect(page.getByRole("button", { name: "Noah Williams's Story" })).not.toHaveClass(/unviewed/);
    await viewer.getByRole("button", { name: "Close Story" }).click();
    await expect(viewer).toBeHidden();
});

test("Story owners can inspect viewers and delete through authoritative endpoints", async ({ page }) => {
    await page.clock.install();
    await signInWithStories(page);
    await freezeClock(page);
    await page.getByRole("button", { name: "Your Story", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await viewer.getByRole("button", { name: "2 views" }).click();
    const viewers = page.getByRole("dialog", { name: "Story viewers" });
    await expect(viewers).toContainText("Viewed by 2");
    await expect(viewers).toContainText("Noah Williams");
    await expect(viewers).toContainText("@noah");
    await expect(viewers.locator(".story-capture-badge")).toContainText("1 screenshot");
    await viewers.getByRole("button", { name: "Done" }).click();
    await viewer.getByRole("button", { name: "Story options" }).click();
    await viewer.getByRole("menuitem", { name: "Delete Story" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this Story?" });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(viewer).toBeVisible();
    await viewer.getByRole("button", { name: "Story options" }).click();
    await viewer.getByRole("menuitem", { name: "Delete Story" }).click();
    await confirm.getByRole("button", { name: "Delete Story" }).click();
    await expect(page.getByText("Story deleted", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Your Story", exact: true })).toHaveCount(0);
});

test("Story reports ask for a reason in a sheet and remove reported content", async ({ page }) => {
    await page.clock.install();
    await page.goto("/app/?demo=1&signin=1&stories=1");
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        const original = DemoAPI.prototype.reportStory;
        window.storyReports = [];
        DemoAPI.prototype.reportStory = async function (userId, storyId, reason) {
            window.storyReports.push({ storyId, reason });
            return original.call(this, userId, storyId, reason);
        };
    });
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await freezeClock(page);
    await page.getByRole("button", { name: "Noah Williams's Story, new" }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await viewer.getByRole("button", { name: "Story options" }).click();
    await expect(viewer.getByRole("menuitem", { name: "Delete Story" })).toHaveCount(0);
    await viewer.getByRole("menuitem", { name: "Report inappropriate content" }).click();
    const sheet = page.getByRole("dialog", { name: "Report this Story" });
    await expect(sheet.getByRole("button", { name: "Report" })).toBeDisabled();
    // The Story holds still while the sheet is open.
    const before = await storyProgress(viewer);
    await page.clock.runFor(6_000);
    await expect(viewer).toBeVisible();
    expect(await storyProgress(viewer)).toBeCloseTo(before, 2);
    await sheet.getByRole("radio", { name: "Harassment or bullying" }).check();
    await sheet.getByRole("button", { name: "Report" }).click();
    await expect(page.getByText("Story reported", { exact: true })).toBeVisible();
    await expect(viewer).toBeHidden();
    expect(await page.evaluate(() => window.storyReports)).toEqual([{ storyId: "story-noah", reason: "harassment" }]);
    await expect(page.getByRole("button", { name: /Noah Williams's Story/ })).toHaveCount(0);
});

test("Story composer prepares and publishes a photo through the feature-gated surface", async ({ page }) => {
    await page.clock.install();
    await signInWithStories(page);
    await page.getByRole("button", { name: "Add Story" }).click();
    const composer = page.getByRole("dialog", { name: "Create Story" });
    // Camera and library, like iOS: only the camera input forces capture.
    await expect(composer.locator(".story-camera-input")).toHaveAttribute("capture", "environment");
    await expect(composer.locator(".story-file-input")).not.toHaveAttribute("capture", /.*/);
    await expect(composer.getByText("Camera", { exact: true })).toBeVisible();
    await expect(composer.getByText("Library", { exact: true })).toBeVisible();
    await composer.locator(".story-file-input").setInputFiles("assets/AppIconV2.png");
    await expect(composer.getByText("Photo ready to post")).toBeVisible();
    // The composer frame has the viewer's shape (9 : 19.5).
    const frame = await composer.locator(".story-composer-preview").boundingBox();
    expect(frame.width / frame.height).toBeCloseTo(9 / 19.5, 1);
    await composer.getByLabel("Caption").fill("After practice");
    await composer.getByLabel("Text overlay").fill("finally ✨");
    const overlayHandle = composer.locator("[data-media-overlay-position]");
    await expect(overlayHandle).toHaveAccessibleName(/50% from left, 50% from top/);
    await overlayHandle.press("ArrowLeft");
    await overlayHandle.press("Shift+ArrowUp");
    await expect(overlayHandle).toHaveAccessibleName(/48% from left, 40% from top/);
    await composer.getByRole("button", { name: "Post Story" }).click();
    await expect(composer).toBeHidden();
    await expect(page.getByText("Story posted", { exact: true })).toBeVisible();
    await freezeClock(page); // Keep the posted Story on screen while it is measured.
    await page.getByRole("button", { name: "Your Story", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await viewer.getByRole("button", { name: "Next Story" }).click();
    const renderedOverlay = viewer.locator(".story-text-overlay");
    await expect(renderedOverlay).toHaveText("finally ✨");
    // Captions are placed against the full Story stage, the frame the author
    // dragged in (and the screen on iOS), not a shorter media box.
    expect(await renderedOverlay.evaluate((node) => node.parentElement.getBoundingClientRect().height))
        .toBeCloseTo(await viewer.locator(".story-stage").evaluate((node) => node.getBoundingClientRect().height), 0);
    const renderedPosition = await renderedOverlay.evaluate((node) => {
        const media = node.parentElement.getBoundingClientRect();
        const overlay = node.getBoundingClientRect();
        return {
            x: (overlay.left + overlay.width / 2 - media.left) / media.width,
            y: (overlay.top + overlay.height / 2 - media.top) / media.height,
        };
    });
    expect(renderedPosition.x).toBeCloseTo(0.48, 2);
    expect(renderedPosition.y).toBeCloseTo(0.4, 2);
});

test("a failed Story publish resumes once after reload with its saved request identity", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1&stories=1&storyfail=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Add Story" }).click();
    const composer = page.getByRole("dialog", { name: "Create Story" });
    await composer.locator(".story-file-input").setInputFiles("assets/AppIconV2.png");
    await expect(composer.getByRole('group', { name: 'Photo effect' })).toHaveCount(0);
    await expect(composer.getByText("Photo ready to post", { exact: true })).toBeVisible();
    await composer.getByLabel("Text overlay").fill("Recover me");
    const overlayHandle = composer.locator("[data-media-overlay-position]");
    await overlayHandle.press("Shift+ArrowLeft");
    await overlayHandle.press("Shift+ArrowDown");
    await composer.getByRole("button", { name: "Post Story" }).click();
    await expect(composer.getByText(/Temporary Story outage.*saved on this device/)).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
        const { listChatMediaOutbox } = await import("/app/chat/outbox.js");
        const record = (await listChatMediaOutbox("demo-user")).find((item) => item.kind === "story");
        return record ? {
            overlay: record.overlay,
            fileType: record.file.type,
            fileName: record.file.name,
            hasEffectMetadata: Object.hasOwn(record, "photo_effect"),
        } : null;
    })).toEqual({
        overlay: { text: "Recover me", x: 0.4, y: 0.6 },
        fileType: "image/jpeg",
        fileName: "chat-photo.jpg",
        hasEffectMetadata: false,
    });
    await expect.poll(() => page.evaluate(() => localStorage.getItem("valid:demo-story-failed-once"))).toBe("1");
    await page.reload();
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("region", { name: "Stories" })).toBeVisible();
    await page.waitForTimeout(4_200); // First retry uses the shared bounded four-second backoff.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => page.evaluate(async () => {
        const { listChatMediaOutbox } = await import("/app/chat/outbox.js");
        return (await listChatMediaOutbox("demo-user")).filter((record) => record.kind === "story").length;
    }), { timeout: 5_000 }).toBe(0);
    await page.getByRole("button", { name: "Your Story", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Story viewer" }).locator(".story-progress i")).toHaveCount(2, { timeout: 5_000 });
});

test("Story replies and classmate shares use idempotent chat delivery", async ({ page }) => {
    await page.clock.install();
    await signInWithStories(page);
    await freezeClock(page);
    await page.getByRole("button", { name: "Noah Williams's Story, new" }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await expect(viewer.getByRole("button", { name: "Send reply" })).toBeDisabled();
    await viewer.getByLabel("Reply to Story").fill("This is great");
    await viewer.getByRole("button", { name: "Send reply" }).click();
    await expect(page.getByText("Reply sent", { exact: true })).toBeVisible();
    await page.clock.runFor(20); // The demo names new chats by the (frozen) clock.
    await viewer.getByRole("button", { name: "Send Story" }).click();
    const share = page.getByRole("dialog", { name: "Share Story" });
    await expect(share).toContainText("Only classmates who can already view it are shown.");
    await expect(share.getByRole("button", { name: "Choose people" })).toBeDisabled();
    await expect(share.getByRole("checkbox", { name: /Noah Williams/ })).toHaveCount(0);
    await share.getByRole("checkbox", { name: /Maya Chen/ }).check();
    await expect(share).toContainText("1 selected");
    await share.getByRole("button", { name: "Send Story" }).click();
    await expect(share).toBeHidden();
    await expect(page.getByText("Story sent", { exact: true })).toBeVisible();
    await viewer.getByRole("button", { name: "Close Story" }).click();
    await page.clock.resume();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Maya Chen/ }).first().click();
    await page.getByRole("button", { name: "Skip for today" }).click();
    await expect(page.getByText(/Shared Story/)).toBeVisible();
    await expect(page.getByRole("img", { name: "Photo" }).last()).toBeVisible();
});

test("an exact Story deep link opens the authoritative item after sign-in", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1&stories=1&story=story-noah");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await expect(viewer.getByRole("img", { name: "Noah Williams's Story" })).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/story=story-noah/);
    await viewer.getByRole("button", { name: "Close Story" }).click();
    await expect(page).not.toHaveURL(/story=/);
});

test("production Story adapter matches feed, view, viewer, delete, and report contracts", async ({ page }) => {
    const origin = "https://api.six7.lol";
    const userId = "11111111-1111-1111-1111-111111111111";
    const storyId = "22222222-2222-2222-2222-222222222222";
    await page.addInitScript((value) => { window.VALID_API_BASE_URL = `${value}/api/v1`; }, origin);
    const requests = [];
    await page.route(`${origin}/api/v1/**`, async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        requests.push({ method: request.method(), path: `${url.pathname}${url.search}`, body: request.postData() ? request.postDataJSON() : null });
        if (request.method() === "DELETE") return route.fulfill({ status: 204, body: "" });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(url.pathname.endsWith("/viewers") ? { story_id: storyId, viewers: [], next_cursor: null } : url.pathname.endsWith("/reports") ? { story_id: storyId, reported: true } : url.pathname.endsWith("/views") ? { story_id: storyId, created: true } : { authors: [], server_time: new Date().toISOString() }) });
    });
    await page.goto("/app/?signin=1");
    requests.length = 0;
    await page.evaluate(async ({ userId: id, storyId: story }) => {
        const { ValidAPI } = await import("/app/api.js");
        const api = new ValidAPI();
        api.saveSession({ access_token: "story-token", user: { id } });
        await api.createStoryUpload(id, { contentType: "video/mp4", sizeBytes: 1024, thumbnailSizeBytes: 128, durationMs: 5000, clientRequestId: "33333333-3333-3333-3333-333333333333" });
        await api.finalizeStoryUpload(id, "44444444-4444-4444-4444-444444444444");
        await api.publishStory(id, "44444444-4444-4444-4444-444444444444", { caption: "Hi", overlay: { text: "There", x: 0.4, y: 0.6 }, clientRequestId: "55555555-5555-5555-5555-555555555555" });
        await api.getStories(id);
        await api.recordStoryView(id, story);
        await api.getStoryViewers(id, story, { cursor: "next page", limit: 500 });
        await api.reportStory(id, story, "Unsafe content");
        await api.deleteStory(id, story);
    }, { userId, storyId });

    expect(requests).toEqual([
        { method: "POST", path: `/api/v1/users/${userId}/story-uploads`, body: { content_type: "video/mp4", size_bytes: 1024, thumbnail_size_bytes: 128, video_duration_ms: 5000, client_request_id: "33333333-3333-3333-3333-333333333333" } },
        { method: "POST", path: `/api/v1/users/${userId}/story-uploads/44444444-4444-4444-4444-444444444444/finalize`, body: null },
        { method: "POST", path: `/api/v1/users/${userId}/stories`, body: { media_asset_id: "44444444-4444-4444-4444-444444444444", client_request_id: "55555555-5555-5555-5555-555555555555", caption: "Hi", text_overlay: "There", text_overlay_x: 0.4, text_overlay_y: 0.6 } },
        { method: "GET", path: `/api/v1/users/${userId}/stories`, body: null },
        { method: "POST", path: `/api/v1/users/${userId}/stories/${storyId}/views`, body: null },
        { method: "GET", path: `/api/v1/users/${userId}/stories/${storyId}/viewers?limit=100&cursor=next+page`, body: null },
        { method: "POST", path: `/api/v1/users/${userId}/stories/${storyId}/reports`, body: { reason: "Unsafe content" } },
        { method: "DELETE", path: `/api/v1/users/${userId}/stories/${storyId}`, body: null },
    ]);
});

test("Story progress times photos for five seconds and auto-advances to the next person, then closes", async ({ page }) => {
    await page.clock.install();
    await signInWithStories(page);
    await freezeClock(page);
    await page.getByRole("button", { name: "Your Story", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await expect(viewer.getByRole("img", { name: "Jules Rivera's Story" })).toBeVisible();
    await page.clock.runFor(20);
    const start = await storyProgress(viewer);
    expect(start).toBeLessThan(0.05);
    await page.clock.runFor(2_500);
    expect(await storyProgress(viewer)).toBeCloseTo(start + 0.5, 1);
    // The bar itself fills, not only the recorded value.
    expect(await viewer.locator(".story-progress i.current b").evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).a))
        .toBeCloseTo(start + 0.5, 1);
    await expect(viewer.locator(".story-author strong")).toHaveText("Your Story");
    await page.clock.runFor(2_700);
    await expect(viewer.locator(".story-author strong")).toHaveText("Noah Williams");
    await expect(page).toHaveURL(/story=story-noah/);
    await expect(viewer.getByRole("img", { name: "Noah Williams's Story" })).toBeVisible();
    // A new person starts a fresh bar (the fake clock may have run on past the switch).
    expect(await storyProgress(viewer)).toBeLessThan(0.6);
    await expect(viewer.locator(".story-progress i")).toHaveCount(1);
    await page.clock.runFor(5_300);
    await expect(viewer).toBeHidden();
    await expect(page).not.toHaveURL(/story=/);
});

test("Story tap zones go back on the left third and forward on the rest", async ({ page }) => {
    await page.clock.install();
    await signInWithStories(page);
    await freezeClock(page);
    await page.getByRole("button", { name: "Your Story", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    const author = viewer.locator(".story-author strong");
    await expect(author).toHaveText("Your Story");
    let point = await stagePoint(viewer, 0.45);
    await page.mouse.click(point.x, point.y);
    await expect(author).toHaveText("Noah Williams");
    point = await stagePoint(viewer, 0.2);
    await page.mouse.click(point.x, point.y);
    await expect(author).toHaveText("Your Story");
    // Keyboard and assistive technology keep explicit controls.
    await viewer.getByRole("button", { name: "Next Story" }).focus();
    await page.keyboard.press("Enter");
    await expect(author).toHaveText("Noah Williams");
    await page.keyboard.press("ArrowLeft");
    await expect(author).toHaveText("Your Story");
});

test("press and hold pauses a Story without navigating; release resumes", async ({ page }) => {
    await page.clock.install();
    await signInWithStories(page);
    await freezeClock(page);
    await page.getByRole("button", { name: "Noah Williams's Story, new" }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await expect(viewer.getByRole("img", { name: "Noah Williams's Story" })).toBeVisible();
    const point = await stagePoint(viewer, 0.7);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.clock.runFor(300);
    const held = await storyProgress(viewer);
    await page.clock.runFor(3_000);
    expect(await storyProgress(viewer)).toBeCloseTo(held, 2);
    await expect(viewer).toHaveClass(/paused/);
    await page.mouse.up();
    await expect(viewer).not.toHaveClass(/paused/);
    await expect(viewer.locator(".story-author strong")).toHaveText("Noah Williams");
    await expect(viewer).toBeVisible();
    await page.clock.runFor(1_000);
    expect(await storyProgress(viewer)).toBeGreaterThan(held + 0.15);
});

test("swiping down follows the finger, springs back when short, and dismisses when far enough", async ({ page }) => {
    await page.clock.install();
    await signInWithStories(page);
    await freezeClock(page);
    await page.getByRole("button", { name: "Noah Williams's Story, new" }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await expect(viewer.getByRole("img", { name: "Noah Williams's Story" })).toBeVisible();
    const from = await stagePoint(viewer, 0.5, 0.45);
    await drag(page, from, { x: from.x, y: from.y + 60 });
    expect((await stageOffset(viewer)).y).toBeCloseTo(60, -1);
    await page.mouse.up();
    await expect.poll(async () => (await stageOffset(viewer)).y).toBeCloseTo(0, 0);
    await expect(viewer).toBeVisible();
    await expect(viewer.locator(".story-author strong")).toHaveText("Noah Williams");
    await drag(page, from, { x: from.x, y: from.y + 180 });
    await page.mouse.up();
    await page.clock.runFor(200);
    await expect(viewer).toBeHidden();
    await expect(page).not.toHaveURL(/story=/);
});

test("swiping sideways changes person with a rubber band at the ends", async ({ page }) => {
    await page.clock.install();
    await signInWithStories(page);
    await freezeClock(page);
    await page.getByRole("button", { name: "Your Story", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    const author = viewer.locator(".story-author strong");
    await expect(author).toHaveText("Your Story");
    const from = await stagePoint(viewer, 0.6, 0.45);
    // Nobody before the first person: the stage resists (18%) and settles back.
    await drag(page, from, { x: from.x + 100, y: from.y });
    expect((await stageOffset(viewer)).x).toBeCloseTo(18, -1);
    await page.mouse.up();
    await expect.poll(async () => (await stageOffset(viewer)).x).toBeCloseTo(0, 0);
    await expect(author).toHaveText("Your Story");
    await drag(page, from, { x: from.x - 110, y: from.y + 10 });
    expect((await stageOffset(viewer)).x).toBeCloseTo(-110, -1);
    await page.mouse.up();
    await expect(author).toHaveText("Noah Williams");
    await expect(viewer).toBeVisible();
    await expect.poll(async () => (await stageOffset(viewer)).x).toBeCloseTo(0, 0);
});

test("Story videos autoplay inline without controls and advance when they end", async ({ page }) => {
    await routeDemoVideo(page);
    // The clip is 2 s, so record what the player looked like while it played
    // (media events do not bubble, but they do pass the document on capture).
    await page.addInitScript(() => {
        window.storyVideoLog = { played: null, samples: [] };
        document.addEventListener("playing", (event) => {
            const node = event.target;
            if (!node.matches?.(".story-video") || window.storyVideoLog.played) return;
            window.storyVideoLog.played = {
                controls: node.controls, inline: node.hasAttribute("playsinline"), muted: node.muted,
                poster: new URL(node.poster).pathname, src: new URL(node.currentSrc).pathname,
                story: new URLSearchParams(location.search).get("story"),
                captions: document.querySelector(".story-overlays").textContent,
            };
        }, true);
        document.addEventListener("timeupdate", (event) => {
            const node = event.target;
            if (!node.matches?.(".story-video") || !(node.duration > 0) || !node.currentTime || node.ended) return;
            window.storyVideoLog.samples.push({ played: node.currentTime / node.duration, bar: Number(document.querySelector(".story-progress").dataset.progress) });
        }, true);
    });
    await signInWithStories(page, "&storyvideo=1&story=story-maya-video");
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    const playable = await page.evaluate(() => document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"') !== "");
    test.skip(!playable, "This browser build has no H.264 decoder");
    await expect(page).toHaveURL(/story=story-maya-processing/, { timeout: 15_000 });
    const log = await page.evaluate(() => window.storyVideoLog);
    expect(log.played).toMatchObject({ controls: false, inline: true, poster: "/assets/app/aura.webp", src: "/assets/demo.mp4", story: "story-maya-video", captions: "pregame 🏀" });
    // The bar followed the video's own clock.
    expect(log.samples.length).toBeGreaterThan(0);
    for (const sample of log.samples) expect(Math.abs(sample.played - sample.bar)).toBeLessThan(0.25);
    // Sound is tried first; a browser that refuses it falls back to muted with a pill.
    if (log.played.muted) await expect(viewer.getByRole("button", { name: "Unmute Story" })).toHaveCount(1);
    await expect(viewer.locator(".story-author strong")).toHaveText("Maya Chen");
});

test("a processing Story video shows its poster, polls, and plays the web rendition when ready", async ({ page }) => {
    await page.clock.install();
    await routeDemoVideo(page);
    await page.goto("/app/?demo=1&signin=1&stories=1&storyvideo=1&story=story-maya-processing");
    await freezeClock(page);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await expect(viewer.getByRole("status").filter({ hasText: "Processing video…" })).toBeVisible();
    await expect(viewer.locator(".story-photo")).toHaveAttribute("src", /aura\.webp/);
    await expect(viewer.locator(".story-video")).toBeHidden();
    await page.clock.runFor(3_200);
    await expect(viewer.getByText("Processing video…")).toBeHidden();
    await expect(viewer.locator(".story-video")).toHaveAttribute("src", /demo\.mp4/);
    await expect(page).toHaveURL(/story=story-maya-processing/);
});

test("an unavailable Story video explains itself and moves on", async ({ page }) => {
    await page.clock.install();
    await page.goto("/app/?demo=1&signin=1&stories=1&storyvideo=1&story=story-maya-unavailable");
    await freezeClock(page);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await expect(viewer.getByText("This video can't play on the web yet.")).toBeVisible();
    await expect(viewer.getByText("Open it in the Valid app to watch.")).toBeVisible();
    await expect(viewer).toBeVisible();
    await page.clock.runFor(5_300);
    await expect(viewer).toBeHidden();
});

test("a story_capture deep link opens the owner's Story viewers list once", async ({ page }) => {
    await signInWithStories(page, "&story=story-jules&viewers=1");
    const viewers = page.getByRole("dialog", { name: "Story viewers" });
    await expect(viewers).toContainText("Viewed by 2");
    await expect(viewers).toContainText("Noah Williams");
    await expect(page).toHaveURL(/story=story-jules/);
    await expect(page).not.toHaveURL(/viewers=1/);
    await viewers.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog", { name: "Story viewer" })).toBeVisible();
});

test("viewers=1 is ignored for someone else's Story", async ({ page }) => {
    await signInWithStories(page, "&story=story-noah&viewers=1");
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await expect(viewer.getByRole("img", { name: "Noah Williams's Story" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Story viewers" })).toBeHidden();
    await expect(page).not.toHaveURL(/viewers=1/);
});

test("a Story viewer row opens a direct chat with that viewer", async ({ page }) => {
    await signInWithStories(page, "&story=story-jules&viewers=1");
    const viewers = page.getByRole("dialog", { name: "Story viewers" });
    await viewers.getByRole("button", { name: /Noah Williams/ }).click();
    await expect(viewers).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Story viewer" })).toBeHidden();
    await expect(page).toHaveURL(/tab=chats/);
    await expect(page).toHaveURL(/chat=chat-/);
});
