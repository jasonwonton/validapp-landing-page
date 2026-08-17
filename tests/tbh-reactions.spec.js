import { expect, test } from "@playwright/test";

async function signIn(page, query = "?demo=1") {
    await page.goto(`/app/${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toHaveAttribute("aria-current", "page");
}

test("poll reactions can be set, changed, removed, and inspected", async ({ page }) => {
    await signIn(page);
    const firstPoll = page.locator("[data-feed-detail='9001']");
    await firstPoll.locator("[data-reactors]").click();
    const reactors = page.getByRole("dialog", { name: "Reactions" });
    await expect(reactors.getByText("Maya Chen")).toBeVisible();
    await reactors.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "School", exact: true }).click();
    const poll = page.locator("[data-feed-detail='9003']");
    await poll.locator("[data-reaction-picker]").click();
    const picker = page.getByRole("dialog", { name: "Choose a reaction" });
    await picker.getByRole("button", { name: "Fire" }).click();
    await expect(poll.locator("[data-reaction-picker]")).toContainText("🔥");
    await expect(poll.locator("[data-reactors]")).toHaveText("20");

    await poll.locator("[data-reaction-picker]").click();
    await picker.getByRole("button", { name: "Fire" }).click();
    await expect(poll.locator("[data-reactors]")).toHaveText("19");
});

test("Settings purchases a TBH with an angle and authoritative aura balance", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Request a TBH for 100 aura" }).click();
    const flow = page.getByRole("dialog", { name: "Request a TBH" });
    await flow.getByRole("button", { name: /Maya Chen/ }).click();
    await flow.getByRole("button", { name: /What vibe do I give off/ }).click();
    page.once("dialog", (confirmation) => confirmation.accept());
    await flow.getByRole("button", { name: "Continue · 100 aura" }).click();
    await expect(flow.getByRole("heading", { name: "Request sent to Maya" })).toBeVisible();
    await flow.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("#profileCard .profile-stat-card").filter({ hasText: "Aura" })).toContainText("1,180");
});

test("Inbox TBH request composer enforces starter and length rules", async ({ page }) => {
    await signIn(page);
    const request = page.locator("[data-tbh-request='tbh-request-1']");
    await expect(request).toContainText("Maya wants a TBH");
    await request.click();
    const composer = page.getByRole("dialog", { name: "Write a TBH" });
    await composer.getByRole("button", { name: "Your vibe is…" }).click();
    await expect(composer.getByRole("button", { name: "Send TBH" })).toBeDisabled();
    await composer.getByLabel("Be honest, specific, and kind…").fill("Your vibe is… welcoming, funny, and confident without trying too hard.");
    await expect(composer.getByRole("button", { name: "Send TBH" })).toBeEnabled();
    await composer.getByRole("button", { name: "Send TBH" }).click();
    await expect(page.locator("#toast")).toContainText("TBH sent");
    await expect(request).toHaveCount(0);
});

test("School merges public TBHs with Recent, Hottest, and content filters", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "School", exact: true }).click();
    await expect(page.getByRole("button", { name: "Recent", exact: true })).toHaveClass(/active/);
    await expect(page.locator("[data-tbh-detail^='school:']")).toHaveCount(2);
    await page.getByRole("button", { name: "TBHs", exact: true }).click();
    await expect(page.locator("[data-feed-detail]")).toHaveCount(0);
    await expect(page.getByText("got a TBH").first()).toBeVisible();
    await page.getByRole("button", { name: "Hottest", exact: true }).click();
    await expect(page.getByRole("button", { name: "Hottest", exact: true })).toHaveClass(/active/);
    await page.getByRole("button", { name: "My Votes", exact: true }).click();
    await expect(page.locator("[data-tbh-detail^='school:']")).toHaveCount(0);
    await expect(page.locator("[data-feed-detail='9004']")).toBeVisible();
});

test("notification routes open the exact TBH request", async ({ page }) => {
    await signIn(page, "?demo=1&notification=tbh_request&tbh_request_id=tbh-request-1");
    await expect(page.getByRole("dialog", { name: "Write a TBH" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "TBH for Maya" })).toBeVisible();
    await expect(page).not.toHaveURL(/tbh_request_id/);
});

test("notification routes open exact TBH responses and reacted polls", async ({ page }) => {
    await signIn(page, "?demo=1&notification=tbh_response&tbh_response_id=tbh-response-1");
    const tbhDetail = page.getByRole("dialog", { name: "TBH from Noah" });
    await expect(tbhDetail).toBeVisible();
    await expect(tbhDetail.getByText(/every group project more fun/)).toBeVisible();
    await expect(page).not.toHaveURL(/tbh_response_id/);
    await tbhDetail.getByRole("button", { name: "Close" }).click();

    await signIn(page, "?demo=1&notification=feed_item&question_answer_id=9003");
    await expect(page.getByRole("dialog", { name: "Poll details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who has the best music taste?" })).toBeVisible();
    await expect(page).not.toHaveURL(/question_answer_id/);
});
