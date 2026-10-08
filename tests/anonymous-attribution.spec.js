import { expect, test } from '@playwright/test';

// An anonymous question reads "Someone at your school" to everyone, its author
// included, in Play and in the poll detail the feed and inbox open. The API
// sends the author their own name for their anonymous question (marked
// revealed); these tests feed exactly that. The author also sees a private
// hint. The demo account's user id is "demo-user".

const QUESTION = 'Who would survive a zombie apocalypse?';

async function signInWith(page, { play = null, feed = null }) {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async ({ play, feed }) => {
        const { DemoAPI } = await import('/app/demo-api.js');
        if (play) {
            DemoAPI.prototype.getPlayQuestions = async function () {
                return { questions: [{ id: 990042, image_url: '../assets/app/pencil-clipboard.webp', ...play }] };
            };
        }
        if (feed) {
            const original = DemoAPI.prototype.getPersonalFeed;
            DemoAPI.prototype.getPersonalFeed = function (...args) {
                Object.assign(this.personalFeed[0], feed);
                return original.apply(this, args);
            };
        }
    }, { play, feed });
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByRole('button', { name: 'Feed', exact: true })).toHaveAttribute('aria-current', 'page');
}

const playAuthor = { question_text: QUESTION, is_school_question: true, is_user_submitted: true, is_anonymous: true, submitted_by_user_id: 'demo-user', submitted_by_name: 'Jamie Rivera', submitted_by_avatar_url: '../assets/AppIconV2.png', can_reveal_submitter: false, question_submitter_revealed: true };
const playClassmate = { ...playAuthor, submitted_by_user_id: null, submitted_by_name: null, submitted_by_avatar_url: null, question_submitter_revealed: false };
const feedAuthor = { question_text: QUESTION, question_school_id: 1, question_is_user_submitted: true, question_is_anonymous: true, question_submitted_by_user_id: 'demo-user', question_submitted_by_display_name: 'Jamie Rivera', question_submitted_by_profile_picture_url: '../assets/AppIconV2.png', can_reveal_question_submitter: false, question_submitter_revealed: true };
const feedClassmate = { ...feedAuthor, question_submitted_by_user_id: null, question_submitted_by_display_name: null, question_submitted_by_profile_picture_url: null, question_submitter_revealed: false };

test('Play: the author of an anonymous question sees it anonymously, with the private hint', async ({ page }) => {
    await signInWith(page, { play: playAuthor });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const attribution = page.locator('#playCard .play-card:not(.play-card-leaving) .question-attribution');
    await expect(attribution).toContainText('Someone at your school');
    await expect(attribution).not.toContainText('Jamie Rivera');
    await expect(attribution.locator('img')).toHaveAttribute('src', /anonymous\.webp/);
    await expect(attribution.locator('[data-submitter-author-hint]')).toHaveText('Your name is hidden from classmates');
    await expect(attribution.getByRole('menuitem', { name: 'Block submitter', includeHidden: true })).toHaveCount(0);
});

test('Play: classmates see an anonymous question anonymously, without the hint', async ({ page }) => {
    await signInWith(page, { play: playClassmate });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const attribution = page.locator('#playCard .play-card:not(.play-card-leaving) .question-attribution');
    await expect(attribution).toContainText('Someone at your school');
    await expect(attribution.locator('[data-submitter-author-hint]')).toHaveCount(0);
});

test('Play: a named question still shows its author', async ({ page }) => {
    await signInWith(page, { play: { ...playAuthor, is_anonymous: false, question_submitter_revealed: false } });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const attribution = page.locator('#playCard .play-card:not(.play-card-leaving) .question-attribution');
    await expect(attribution).toContainText('Jamie Rivera');
    await expect(attribution.locator('[data-submitter-author-hint]')).toHaveCount(0);
});

test('Poll detail: the author of an anonymous question sees it anonymously, with the private hint', async ({ page }) => {
    await signInWith(page, { feed: feedAuthor });
    await page.locator('[data-feed-detail="9001"]').click();
    const author = page.locator('.poll-submitter-row');
    await expect(author).toContainText('Someone at your school');
    await expect(author).not.toContainText('Jamie Rivera');
    await expect(author.locator('img')).toHaveAttribute('src', /anonymous\.webp/);
    await expect(author.locator('[data-submitter-author-hint]')).toHaveText('Your name is hidden from classmates');
    await expect(page.locator('#blockFeedSubmitterButton')).toBeHidden();
});

test('Poll detail: classmates see an anonymous question anonymously, without the hint', async ({ page }) => {
    await signInWith(page, { feed: feedClassmate });
    await page.locator('[data-feed-detail="9001"]').click();
    const author = page.locator('.poll-submitter-row');
    await expect(author).toContainText('Someone at your school');
    await expect(author.locator('[data-submitter-author-hint]')).toHaveCount(0);
});
