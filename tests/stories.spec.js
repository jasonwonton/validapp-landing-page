import { expect, test } from "@playwright/test";

async function signInWithStories(page) {
    await page.goto("/app/?demo=1&signin=1&stories=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("region", { name: "Stories" })).toBeVisible();
}

test("native Stories can stay enabled while the independent web surface remains dark", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1&native-stories=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("region", { name: "Stories" })).toHaveCount(0);
});

test("Story rail reveals signed media before recording the authoritative view", async ({ page }) => {
    await signInWithStories(page);
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
    await signInWithStories(page);
    await page.getByRole("button", { name: "Your Story", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await viewer.getByRole("button", { name: "Viewers" }).click();
    const viewers = page.getByRole("dialog", { name: "Story viewers" });
    await expect(viewers).toContainText("Noah Williams");
    await expect(viewers).toContainText("1 screenshot");
    await viewers.getByRole("button", { name: "Done" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await viewer.getByRole("button", { name: "Delete Story" }).click();
    await expect(page.getByText("Story deleted", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Your Story", exact: true })).toHaveCount(0);
});

test("Story reports use the released moderation contract and remove reported content", async ({ page }) => {
    await signInWithStories(page);
    await page.getByRole("button", { name: "Noah Williams's Story, new" }).click();
    page.once("dialog", (dialog) => dialog.accept("Unsafe content"));
    await page.getByRole("dialog", { name: "Story viewer" }).getByRole("button", { name: "Report Story" }).click();
    await expect(page.getByText("Story reported", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Noah Williams's Story/ })).toHaveCount(0);
});

test("Story composer prepares and publishes a photo through the feature-gated surface", async ({ page }) => {
    await signInWithStories(page);
    await page.getByRole("button", { name: "Add Story" }).click();
    const composer = page.getByRole("dialog", { name: "Create Story" });
    await composer.locator(".story-file-input").setInputFiles("assets/AppIconV2.png");
    await expect(composer.getByText("Photo ready to post")).toBeVisible();
    await composer.getByLabel("Caption").fill("After practice");
    await composer.getByLabel("Text overlay").fill("finally ✨");
    await composer.getByRole("button", { name: "Post Story" }).click();
    await expect(composer).toBeHidden();
    await expect(page.getByText("Story posted", { exact: true })).toBeVisible();
});

test("a failed Story publish resumes once after reload with its saved request identity", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1&stories=1&storyfail=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Add Story" }).click();
    const composer = page.getByRole("dialog", { name: "Create Story" });
    await composer.locator(".story-file-input").setInputFiles("assets/AppIconV2.png");
    await composer.getByRole("button", { name: "Post Story" }).click();
    await expect(composer.getByText(/Temporary Story outage.*saved on this device/)).toBeVisible();
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
    await signInWithStories(page);
    await page.getByRole("button", { name: "Noah Williams's Story, new" }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await viewer.getByLabel("Reply to Story").fill("This is great");
    await viewer.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Reply sent", { exact: true })).toBeVisible();
    await viewer.getByRole("button", { name: "Share", exact: true }).click();
    const share = page.getByRole("dialog", { name: "Share Story" });
    await share.getByRole("checkbox", { name: /Maya Chen/ }).check();
    await share.getByRole("button", { name: "Send Story" }).click();
    await expect(share).toBeHidden();
    await expect(page.getByText("Story sent", { exact: true })).toBeVisible();
    await viewer.getByRole("button", { name: "Close Story" }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Maya Chen/ }).first().click();
    await page.locator(".chat-daily-row > button").click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Skip for today" }).click();
    await expect(page.getByText(/Shared Story/)).toBeVisible();
    await expect(page.getByRole("img", { name: "Photo" }).last()).toBeVisible();
});

test("an exact Story deep link opens the authoritative item after sign-in", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1&stories=1&story=story-noah");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    const viewer = page.getByRole("dialog", { name: "Story viewer" });
    await expect(viewer.getByRole("img", { name: "Noah Williams's Story" })).toBeVisible();
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
