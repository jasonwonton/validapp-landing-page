// Captures the web-v115 anonymous-question screens at 390x844 from the local demo:
// the author's own anonymous question in Play and in the poll detail, and a
// classmate's view of the same question for comparison.
// Usage: python3 -m http.server 4180 (repo root), then node scripts/capture-anonymous-attribution.mjs
import { chromium, devices } from "@playwright/test";

const base = process.env.BASE_URL || "http://127.0.0.1:4180";
const out = new URL("../reports/web-v115-anonymous-always/", import.meta.url).pathname;
const QUESTION = "Who would survive a zombie apocalypse?";
const playAuthor = { question_text: QUESTION, is_school_question: true, is_user_submitted: true, is_anonymous: true, submitted_by_user_id: "demo-user", submitted_by_name: "Jamie Rivera", submitted_by_avatar_url: "../assets/AppIconV2.png", can_reveal_submitter: false, question_submitter_revealed: true };
const playClassmate = { ...playAuthor, submitted_by_user_id: null, submitted_by_name: null, submitted_by_avatar_url: null, question_submitter_revealed: false };
const feedAuthor = { question_text: QUESTION, question_school_id: 1, question_is_user_submitted: true, question_is_anonymous: true, question_submitted_by_user_id: "demo-user", question_submitted_by_display_name: "Jamie Rivera", question_submitted_by_profile_picture_url: "../assets/AppIconV2.png", can_reveal_question_submitter: false, question_submitter_revealed: true };
const feedClassmate = { ...feedAuthor, question_submitted_by_user_id: null, question_submitted_by_display_name: null, question_submitted_by_profile_picture_url: null, question_submitter_revealed: false };

const browser = await chromium.launch();
async function open({ play = null, feed = null }) {
    const context = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`${base}/app/?demo=1&signin=1`);
    await page.evaluate(async ({ play, feed }) => {
        const { DemoAPI } = await import("/app/demo-api.js");
        if (play) DemoAPI.prototype.getPlayQuestions = async () => ({ questions: [{ id: 990042, image_url: "../assets/app/pencil-clipboard.webp", ...play }] });
        if (feed) {
            const original = DemoAPI.prototype.getPersonalFeed;
            DemoAPI.prototype.getPersonalFeed = function (...args) { Object.assign(this.personalFeed[0], feed); return original.apply(this, args); };
        }
    }, { play, feed });
    await page.getByRole("button", { name: /^sign in$/i }).click();
    return { context, page };
}

async function shoot({ play, feed }, file) {
    const { context, page } = await open({ play, feed });
    if (play) {
        await page.getByRole("button", { name: "Play", exact: true }).click();
        await page.locator("#playCard .play-card .question-attribution").first().waitFor();
    } else {
        await page.locator('[data-feed-detail="9001"]').click();
        await page.locator(".poll-submitter-row").waitFor();
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}${file}` });
    await context.close();
}

await shoot({ play: playAuthor }, "1-author-play-390x844.png");
await shoot({ feed: feedAuthor }, "2-author-inbox-poll-detail-390x844.png");
await shoot({ play: playClassmate }, "3-classmate-play-390x844.png");
await shoot({ feed: feedClassmate }, "4-classmate-inbox-poll-detail-390x844.png");
await browser.close();
