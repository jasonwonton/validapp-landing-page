import { expect, test } from "@playwright/test";

const POLL_ROOT = "11111111-1111-4111-8111-111111111111";
const POLL_REPLY = "11111111-1111-4111-8111-111111111113";
const OWN_POLL_ROOT = "11111111-1111-4111-8111-111111111114";
const TBH_REPLY = "22222222-2222-4222-8222-222222222222";

async function signIn(page, suffix = "") {
    await page.goto(`/app/?demo=1&signin=1${suffix}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toHaveAttribute("aria-current", "page");
}

test("poll comments support bounded threads, replies, reactions, deletion, and reporting", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "School", exact: true }).click();
    const poll = page.locator("[data-feed-detail='9003']");
    await poll.getByRole("button", { name: "Open 4 comments" }).click();

    const comments = page.getByRole("dialog", { name: "Comments" });
    await expect(comments).toBeVisible();
    await expect(comments.getByText("This one is so accurate.")).toBeVisible();
    await comments.getByRole("button", { name: "View 2 replies" }).click();
    await expect(comments.getByText("The playlist proves it 🔥")).toBeVisible();

    const root = comments.locator(`[data-comment-id='${POLL_ROOT}']`);
    await root.getByRole("button", { name: "Reply" }).click();
    await comments.getByLabel("Add a comment").fill("Adding a safe, named reply.");
    await comments.getByRole("button", { name: "Send", exact: true }).click();
    await expect(comments.getByText("Adding a safe, named reply.")).toBeVisible();
    await expect(poll.locator("[data-comment-count]")).toHaveText("5");

    await root.getByRole("button", { name: "React", exact: true }).click();
    await root.getByRole("button", { name: "Love" }).click();
    await expect(root.getByRole("button", { name: "View 3 reactions" })).toBeVisible();
    await root.getByRole("button", { name: "View 3 reactions" }).click();
    const reactors = page.getByRole("dialog", { name: "Reactions" });
    await expect(reactors.getByText("Maya Chen").first()).toBeVisible();
    await reactors.getByRole("button", { name: "Done" }).click();

    page.once("dialog", (dialog) => dialog.accept());
    await comments.locator(`[data-comment-id='${OWN_POLL_ROOT}']`).getByRole("button", { name: "Delete" }).click();
    await expect(comments.locator(`[data-comment-id='${OWN_POLL_ROOT}']`)).toHaveCount(0);
    await expect(poll.locator("[data-comment-count]")).toHaveText("4");

    page.once("dialog", (dialog) => dialog.accept());
    await root.getByRole("button", { name: "Report" }).click();
    await expect(root).toHaveCount(0);
    await expect(poll.locator("[data-comment-count]")).toHaveText("0");
});

test("comment moderation notice can be acknowledged while restrictions remain authoritative", async ({ page }) => {
    await signIn(page, "&commentnotice=1&commentrestricted=1");
    await page.getByRole("button", { name: "School", exact: true }).click();
    await page.locator("[data-feed-detail='9003']").getByRole("button", { name: "Open 4 comments" }).click();

    const comments = page.getByRole("dialog", { name: "Comments" });
    await expect(comments.getByRole("alert")).toContainText("One of your comments was reported and hidden.");
    await comments.getByRole("button", { name: "Got it" }).click();
    await expect(comments.getByRole("alert")).toBeHidden();
    await expect(comments.getByLabel("Add a comment")).toBeDisabled();
    await expect(comments).toContainText("Commenting is paused until");
});

test("a lost create response retries with one stable comment request ID", async ({ page }) => {
    await signIn(page, "&commentfail=1");
    await page.getByRole("button", { name: "School", exact: true }).click();
    const poll = page.locator("[data-feed-detail='9003']");
    await poll.getByRole("button", { name: "Open 4 comments" }).click();
    const comments = page.getByRole("dialog", { name: "Comments" });
    const draft = comments.getByLabel("Add a comment");
    await draft.fill("Retry this comment exactly once.");
    await comments.getByRole("button", { name: "Send", exact: true }).click();
    await expect(comments.locator("#commentsStatus")).toContainText("response was lost");
    await expect(draft).toHaveValue("Retry this comment exactly once.");
    await comments.getByRole("button", { name: "Send", exact: true }).click();
    await expect(comments.getByText("Retry this comment exactly once.")).toHaveCount(1);
    await expect(poll.locator("[data-comment-count]")).toHaveText("5");
});

test("comment notification routes resolve and highlight the exact poll reply", async ({ page }) => {
    await signIn(page, `&notification=feed_item&question_answer_id=9003&comment_id=${POLL_REPLY}`);

    const comments = page.getByRole("dialog", { name: "Comments" });
    await expect(comments).toBeVisible();
    const reply = comments.locator(`[data-comment-id='${POLL_REPLY}']`);
    await expect(reply).toContainText("The playlist proves it");
    await expect(reply).toHaveClass(/highlighted/);
    await expect(page).not.toHaveURL(/comment_id|question_answer_id|notification=/);
});

test("comment notification routes resolve and highlight the exact TBH reply", async ({ page }) => {
    await signIn(page, `&notification=tbh_response&tbh_response_id=tbh-response-1&activity_id=activity-tbh-1&comment_id=${TBH_REPLY}`);

    const comments = page.getByRole("dialog", { name: "Comments" });
    await expect(comments).toBeVisible();
    const reply = comments.locator(`[data-comment-id='${TBH_REPLY}']`);
    await expect(reply).toContainText("Noah always notices the good stuff.");
    await expect(reply).toHaveClass(/highlighted/);
    await expect(page).not.toHaveURL(/comment_id|activity_id|tbh_response_id|notification=/);
});

test("the independent web comment flag removes the UI without changing parent feed routes", async ({ page }) => {
    await signIn(page, "&comments=0");
    await page.getByRole("button", { name: "School", exact: true }).click();
    await expect(page.locator("[data-comments-target]")).toHaveCount(0);
    await page.locator("[data-feed-detail='9003']").click();
    await expect(page.getByRole("dialog", { name: "Poll details" })).toBeVisible();
    await expect(page.locator("#commentsRoot")).toBeEmpty();
});

test("session expiry removes private comment state from the DOM", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "School", exact: true }).click();
    await page.locator("[data-feed-detail='9003']").getByRole("button", { name: "Open 4 comments" }).click();
    await expect(page.getByText("This one is so accurate.")).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new CustomEvent("valid:session-expired")));

    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
    await expect(page.locator("#commentsRoot")).not.toContainText("This one is so accurate.");
    await expect(page.locator("#commentsDialog")).toBeHidden();
});
