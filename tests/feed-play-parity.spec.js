import { expect, test } from '@playwright/test';

async function signIn(page, suffix = '') {
    await page.goto(`/app/?demo=1&signin=1${suffix}`);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByRole('button', { name: 'Feed', exact: true })).toHaveAttribute('aria-current', 'page');
}

test('poll detail title carries the iOS gender emoji and heart', async ({ page }) => {
    await signIn(page);
    const statements = await page.evaluate(async () => {
        const { senderStatement } = await import('/app/feed-sender.js');
        return {
            girl: senderStatement({ voter_gender: 'female', voter_grade: 'Sophomore (C/O 2029)' }, { safeGrade: true }),
            boy: senderStatement({ voter_gender: 'male', voter_grade: '8th Grade' }, { safeGrade: true }),
            person: senderStatement({ voter_gender: 'non-binary', voter_grade: 'Grade 11' }, { safeGrade: true }),
            hidden: senderStatement({ voter_gender: 'female', voter_grade: 'Senior' }, { safeGrade: false }),
            unknown: senderStatement({ voter_grade: 'Senior' }, { safeGrade: true }),
        };
    });
    expect(statements).toEqual({
        girl: 'A Sophomore 👧💗 Girl said',
        boy: 'An 8th grader 👦💙 Boy said',
        person: 'A Junior 🧑💛 Person said',
        hidden: 'A 👧💗 Girl said',
        unknown: '',
    });
    await page.locator('[data-feed-detail="9001"]').click();
    await expect(page.locator('#feedDetailDialog .detail-screen-header > strong')).toHaveText(/^An? .*👧💗 Girl said$/);
});

for (const [width, height] of [[375, 812], [390, 844], [430, 932]]) {
    test(`poll detail fits the poll and engagement row in a ${width}x${height} screen`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await signIn(page);
        await page.locator('[data-feed-detail="9001"]').click();
        const detail = page.locator('#feedDetailDialog');
        await expect(detail).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const engagement = await detail.locator('.detail-engagement-row').boundingBox();
        expect(engagement.y + engagement.height).toBeLessThanOrEqual(height);
        const options = await detail.locator('.feed-detail-option').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
        expect(options).toHaveLength(4);
        // PollSnapshot.swift: 10pt between options and 10pt side margins, 100pt minimum height.
        expect(Math.round(options[1].x - (options[0].x + options[0].width))).toBe(10);
        expect(Math.round(options[2].y - (options[0].y + options[0].height))).toBe(10);
        expect(Math.round(options[0].x)).toBe(10);
        for (const option of options) expect(option.height).toBeGreaterThanOrEqual(100);
        const art = await detail.locator('.feed-detail-art').boundingBox();
        expect(art.width).toBeCloseTo(art.height, 0);
        expect(art.width).toBeLessThanOrEqual(width - 48 + 0.5);
        expect(await detail.locator('.feed-detail-prompt > h3').evaluate(node => getComputedStyle(node).fontSize)).toBe('28px');
        // The brand share row uses the iOS asset-catalog artwork, not redrawn marks.
        for (const [platform, file] of [['Snapchat', 'snapchat-logo.webp'], ['Instagram', 'instagram.webp'], ['TikTok', 'tiktok-icon-black-square.webp']]) {
            const button = detail.getByRole('button', { name: `Share poll to ${platform}` });
            await expect(button.locator('img')).toHaveAttribute('src', new RegExp(`${file.replace('.', '\\.')}$`));
            const box = await button.boundingBox();
            expect(box.height).toBeGreaterThanOrEqual(56);
        }
        expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    });
}

async function patchDemo(page, patch) {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(patch);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByRole('button', { name: 'Feed', exact: true })).toHaveAttribute('aria-current', 'page');
}

test('play vote selects instantly, holds 1.2 s even with a fast API, and never double-answers', async ({ page }) => {
    await patchDemo(page, async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.answerQuestion;
        window.__answers = [];
        DemoAPI.prototype.answerQuestion = function (...args) { window.__answers.push(args[1]); return original.apply(this, args); };
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByText('Who would survive longest on a deserted island?')).toBeVisible();
    const first = page.locator('#playCard .play-card:not(.play-card-leaving) [data-choice]').first();
    const started = await page.evaluate(() => performance.now());
    await first.click();
    await expect(first).toHaveClass(/selected/);
    await expect(page.locator('#playCard .play-card:not(.play-card-leaving) [data-choice]').nth(1)).toBeDisabled();
    await expect(page.getByRole('button', { name: /Skip \(3\)/ })).toBeDisabled();
    // The API resolves at once; a second tap during the hold is ignored.
    await page.locator('#playCard [data-choice]').nth(1).dispatchEvent('click');
    await expect(page.getByText('Who should plan the senior trip?')).toBeVisible();
    const elapsed = await page.evaluate((start) => performance.now() - start, started);
    expect(elapsed).toBeGreaterThanOrEqual(1100);
    expect(await page.evaluate(() => window.__answers.length)).toBe(1);
    await expect(page.locator('#auraCount')).toHaveText('1,285');
});

test('play keeps moving when a vote fails and takes back only its aura', async ({ page }) => {
    await patchDemo(page, async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        DemoAPI.prototype.answerQuestion = async function () {
            await new Promise((resolve) => setTimeout(resolve, 100));
            throw Object.assign(new Error('Network down'), { status: 503 });
        };
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.locator('#auraCount')).toHaveText('1,280');
    await page.locator('#playCard [data-choice]').first().click();
    await expect(page.locator('#toast')).toContainText("Your vote didn't go through");
    await expect(page.getByText('Who should plan the senior trip?')).toBeVisible();
    await expect(page.locator('#auraCount')).toHaveText('1,280');
    await expect(page.locator('#playCard .play-card:not(.play-card-leaving) [data-choice]').first()).toBeEnabled();
});

test('play skip waits 0.5 s, shakes the aura counter, and retries failed skips', async ({ page }) => {
    await patchDemo(page, async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        window.__skipAttempts = 0;
        DemoAPI.prototype.skipQuestion = async function () {
            window.__skipAttempts += 1;
            if (window.__skipAttempts === 1) throw Object.assign(new Error('offline'), { status: 0 });
            return { ok: true };
        };
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const started = await page.evaluate(() => performance.now());
    await page.getByRole('button', { name: 'Skip (3)' }).click();
    await expect(page.locator('.play-aura-chip')).toHaveClass(/aura-shake/);
    await expect(page.getByRole('button', { name: 'Skip (2)' })).toBeVisible();
    expect(await page.evaluate((start) => performance.now() - start, started)).toBeGreaterThanOrEqual(450);
    await expect(page.locator('#toast')).toContainText("Skipped. We'll save it when your connection is back.");
    await expect.poll(() => page.evaluate(() => window.__skipAttempts), { timeout: 5000 }).toBe(2);
});

test('play lock countdown uses hours and minutes like PlayLockedView', async ({ page }) => {
    await patchDemo(page, async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.getConfig;
        DemoAPI.prototype.getConfig = async function (...args) { return { ...(await original.apply(this, args)), play_lock_time_seconds: 3930 }; };
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    for (let answered = 0; answered < 4; answered += 1) {
        await page.locator('#playCard .play-card:not(.play-card-leaving) [data-choice]').first().click();
    }
    await page.getByRole('button', { name: 'W aura' }).click();
    await expect(page.locator('#playLockMessage')).toHaveText(/^Unlocks in 1h 5m$/);
});

for (const via of ['Done button', 'history.back()']) {
    test(`closing a feed detail screen with the ${via} keeps the exact feed scroll position`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 360 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await signIn(page);
        await page.getByRole('button', { name: 'School', exact: true }).click();
        await expect(page.locator('#feedList [data-feed-detail]').first()).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, 600));
        await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(600);
        await page.locator('#feedList [data-feed-detail]').last().evaluate((node) => node.click());
        await expect(page.locator('#feedDetailDialog')).toBeVisible();
        if (via === 'Done button') await page.locator('[data-close-feed-detail]').click();
        else await page.evaluate(() => history.back());
        await expect(page.locator('#feedDetailDialog')).toBeHidden();
        await page.waitForTimeout(150);
        expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(600);
        // Tab switching still restores each tab's own position.
        await page.getByRole('button', { name: 'Profile', exact: true }).click();
        await page.getByRole('button', { name: 'Feed', exact: true }).click();
        await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(600);
    });
}

test('feed refreshes itself in place on return to the foreground after 60 s', async ({ page }) => {
    await page.clock.install();
    await patchDemo(page, async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.getPersonalFeed;
        window.__feedCalls = 0;
        DemoAPI.prototype.getPersonalFeed = async function (...args) {
            window.__feedCalls += 1;
            const items = await original.apply(this, args);
            return window.__feedPatch ? window.__feedPatch(items) : items;
        };
    });
    const existing = page.locator("[data-feed-detail='9001']");
    await expect(existing).toBeVisible();
    const callsBefore = await page.evaluate(() => window.__feedCalls);
    const foreground = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    // Within 60 s a foreground reuses the loaded feed.
    await page.clock.fastForward(30_000);
    await foreground();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__feedCalls)).toBe(callsBefore);

    await page.evaluate(() => {
        window.__feedPatch = (items) => [{
            ...items[0], question_answer_id: 'live-poll-1', question_text: 'Who brings great energy every day?',
            timestamp: new Date().toISOString(), is_new: true, comment_count: 0, reaction_count: 0, reaction_summary: {},
        }, ...items];
    });
    await page.clock.fastForward(31_000);
    await foreground();
    await expect(page.locator("[data-feed-detail='live-poll-1']")).toContainText('Who brings great energy every day?');
    await expect(existing).toBeVisible();
    await expect(page.locator('#feedList .feed-skeleton')).toHaveCount(0);

    await page.evaluate(() => { window.__feedPatch = null; });
    await page.clock.fastForward(61_000);
    await foreground();
    await expect(page.locator("[data-feed-detail='live-poll-1']")).toHaveCount(0);
    await expect(existing).toBeVisible();
});

test('feed rows use short iOS timestamps that stay inside their cards', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await signIn(page);
    for (const panel of ['Inbox', 'School']) {
        if (panel === 'School') await page.getByRole('button', { name: 'School', exact: true }).click();
        const times = page.locator('#feedList time');
        await expect(times.first()).toBeVisible();
        const results = await times.evaluateAll((nodes) => nodes.map((node) => {
            const card = node.closest('article, button');
            const box = node.getBoundingClientRect();
            const cardBox = card.getBoundingClientRect();
            return { text: node.textContent, inside: box.left >= cardBox.left - 0.5 && box.right <= cardBox.right + 0.5, clipped: node.scrollWidth > node.clientWidth + 1 };
        }));
        for (const result of results) {
            expect(result.text).toMatch(/^(now|\d+[mhd]|[A-Z][a-z]{2} \d{1,2})$/);
            expect(result.inside, result.text).toBe(true);
            expect(result.clipped, result.text).toBe(false);
        }
    }
});

test('Polls chip counts new polls per Inbox visit like iOS, without an API unread flag', async ({ page }) => {
    await signIn(page);
    const pollsChip = page.locator('[data-inbox-filter="polls"] [data-inbox-count]');
    await expect(page.locator('#feedList [data-feed-detail]').first()).toBeVisible();
    const polls = await page.locator('#feedList [data-feed-detail]').count();
    expect(polls).toBeGreaterThan(0);
    // First visit on a device: the first page is new and stays counted for the visit.
    await expect(pollsChip).toHaveText(String(polls));
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Feed', exact: true }).click();
    // Opening the Inbox marked them read; the next visit starts clean.
    await expect(pollsChip).toBeHidden();
});

test('feed controls answer to 44px hit areas without changing their drawing', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page);
    const hits = await page.evaluate(() => {
        // Probe just inside a 44px target measured from the control's centre.
        const probe = (selector, dx, dy) => {
            const element = document.querySelector(selector);
            const box = element.getBoundingClientRect();
            const hit = document.elementFromPoint(box.left + box.width / 2 + dx, box.top + box.height / 2 + dy);
            return { size: [Math.round(box.width), Math.round(box.height)], hit: hit === element || element.contains(hit) };
        };
        return {
            reactionCountAbove: probe('#feedList .reaction-count-button', 0, -21),
            reactionPickerBelow: probe('#feedList .reaction-picker-button', 0, 21),
            commentAbove: probe('#feedList .comment-count-button', 0, -21),
            inboxChipBelow: probe('[data-inbox-filter="polls"]', 0, 21),
        };
    });
    for (const [name, result] of Object.entries(hits)) expect(result.hit, name).toBe(true);
    expect(hits.reactionCountAbove.size).toEqual([26, 32]);
    const tbhMenu = await page.locator('.tbh-row-menu summary').first().boundingBox();
    expect(tbhMenu.width).toBeGreaterThanOrEqual(44);
    expect(tbhMenu.height).toBeGreaterThanOrEqual(44);
    // Cards are not buttons that contain buttons.
    expect(await page.locator('#feedList [role="button"] button').count()).toBe(0);
    await expect(page.getByRole('button', { name: /^Open poll details:/ }).first()).toBeVisible();
    await page.locator('[data-feed-detail="9001"]').click();
    for (const name of ['Close', 'More poll actions']) {
        const box = await page.locator('#feedDetailDialog').getByRole('button', { name, exact: true }).boundingBox();
        expect(box.height, name).toBeGreaterThanOrEqual(44);
        expect(box.width, name).toBeGreaterThanOrEqual(44);
    }
});

test('account deletion is reachable from Profile information like iOS', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Profile information' }).click();
    const information = page.locator('#profileDialog');
    await information.getByRole('button', { name: 'Delete account' }).click();
    await expect(information).toBeHidden();
    const confirm = page.locator('#deleteAccountDialog');
    await expect(confirm.getByRole('heading', { name: 'Delete Account?' })).toBeVisible();
    await expect(confirm).toContainText('permanently delete your account in 5 days');
    await confirm.getByRole('button', { name: 'Keep my account' }).click();
    await expect(confirm).toBeHidden();
});

test('account deletion warns accounts without a passkey first', async ({ page }) => {
    await signIn(page, '&passkeys=0');
    const enrollment = page.locator('#passkeyEnrollmentDialog');
    await expect(enrollment).toBeVisible();
    await enrollment.getByRole('button', { name: 'Not now' }).click();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Profile information' }).click();
    await page.locator('#profileDialog').getByRole('button', { name: 'Delete account' }).click();
    const warning = page.locator('.ui-sheet');
    await expect(warning).toContainText("Don't Lose Your Account");
    await warning.getByRole('button', { name: 'Delete Anyway' }).click();
    await expect(page.locator('#deleteAccountDialog').getByRole('heading', { name: 'Delete Account?' })).toBeVisible();
});

test('profile photos over 5 MB are circle-cropped and resized to a 1024px JPEG before upload', async ({ page }) => {
    test.setTimeout(90_000);
    await patchDemo(page, async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.uploadProfilePicture;
        DemoAPI.prototype.uploadProfilePicture = async function (userId, file) {
            const bitmap = await createImageBitmap(file);
            window.__upload = { type: file.type, size: file.size, width: bitmap.width, height: bitmap.height };
            await new Promise((resolve) => { window.__finishUpload = resolve; });
            return original.call(this, userId, file);
        };
    });
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    // A 3000x2000 PNG of noise is well over 5 MB; hand it to the file input directly.
    const size = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 3000; canvas.height = 2000;
        const context = canvas.getContext('2d');
        const pixels = context.createImageData(3000, 2000);
        const words = new Uint32Array(pixels.data.buffer);
        let seed = 2463534242;
        for (let index = 0; index < words.length; index += 1) {
            seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
            words[index] = seed | 0xff000000;
        }
        context.putImageData(pixels, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], 'huge.png', { type: 'image/png' }));
        const input = document.querySelector('#profilePictureInput');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return blob.size;
    });
    expect(size).toBeGreaterThan(5 * 1024 * 1024);
    const crop = page.locator('.avatar-crop-dialog');
    await expect(crop).toBeVisible();
    await expect(crop.getByRole('heading', { name: 'Adjust photo' })).toBeVisible();
    const ring = await crop.locator('.avatar-crop-ring').boundingBox();
    expect(Math.round(ring.width)).toBe(Math.round(ring.height));
    // Drag far past the edge: the photo stays clamped over the circle.
    const stage = await crop.locator('.avatar-crop-stage').boundingBox();
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width / 2 + 2000, stage.y + stage.height / 2, { steps: 4 });
    await page.mouse.up();
    const image = await crop.locator('.avatar-crop-image').boundingBox();
    expect(image.x).toBeLessThanOrEqual(ring.x + 1);
    expect(image.x + image.width).toBeGreaterThanOrEqual(ring.x + ring.width - 1);
    await crop.getByRole('button', { name: 'Use photo' }).click();
    await expect(crop).toHaveCount(0);
    // The new photo shows at once while it uploads.
    await expect(page.getByRole('button', { name: 'Uploading profile picture' })).toBeVisible();
    await expect(page.locator('.profile-photo-button img')).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => page.evaluate(() => Boolean(window.__upload))).toBe(true);
    const upload = await page.evaluate(() => window.__upload);
    expect(upload).toMatchObject({ type: 'image/jpeg', width: 1024, height: 1024 });
    expect(upload.size).toBeLessThan(5 * 1024 * 1024);
    await page.evaluate(() => window.__finishUpload());
    await expect(page.locator('#toast')).toContainText('Profile photo updated');
    await expect(page.getByRole('button', { name: 'Change profile picture' })).toBeVisible();
});

test('comments show a loading state, post optimistically with rollback, and report with a reason', async ({ page }) => {
    await patchDemo(page, async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const list = DemoAPI.prototype.listPollComments;
        DemoAPI.prototype.listPollComments = async function (...args) {
            window.__commentLoads = (window.__commentLoads || 0) + 1;
            await new Promise((resolve) => { window.__releaseComments = resolve; });
            return list.apply(this, args);
        };
        const create = DemoAPI.prototype.createPollComment;
        DemoAPI.prototype.createPollComment = async function (...args) {
            await new Promise((resolve) => { window.__releaseCreate = resolve; });
            if (window.__failCreate) throw Object.assign(new Error('Comments are busy right now. Try again.'), { status: 409 });
            return create.apply(this, args);
        };
        window.__demoApi = () => DemoAPI;
    });
    await page.getByRole('button', { name: 'School', exact: true }).click();
    const poll = page.locator("[data-feed-detail='9003']");
    await poll.getByRole('button', { name: 'Open 4 comments' }).click();
    const comments = page.getByRole('dialog', { name: 'Comments' });
    await expect(comments.getByText('Loading comments…')).toBeVisible();
    await expect(comments.getByText('Start the conversation.')).toHaveCount(0);
    await page.evaluate(() => window.__releaseComments());
    await expect(comments.getByText('This one is so accurate.')).toBeVisible();

    // Optimistic post: visible at once, then confirmed.
    const draft = comments.getByLabel('Add a comment');
    await draft.fill('Showing up right away.');
    await comments.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(comments.locator('.comment-pending')).toContainText('Showing up right away.');
    await expect(draft).toHaveValue('');
    await expect(poll.locator('[data-comment-count]')).toHaveText('5');
    await page.evaluate(() => window.__releaseCreate());
    await expect(comments.locator('.comment-pending')).toHaveCount(0);
    await expect(comments.getByText('Showing up right away.')).toBeVisible();

    // Failure rolls back and gives the draft back.
    await page.evaluate(() => { window.__failCreate = true; });
    await draft.fill('This one will fail.');
    await comments.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(comments.locator('.comment-pending')).toHaveCount(1);
    await page.evaluate(() => window.__releaseCreate());
    await expect(comments.locator('.comment-pending')).toHaveCount(0);
    await expect(comments.locator('#commentsStatus')).toContainText('Comments are busy right now.');
    await expect(draft).toHaveValue('This one will fail.');
    await expect(poll.locator('[data-comment-count]')).toHaveText('5');

    // Reports go through the reason sheet with the iOS safety reasons.
    const root = comments.locator("[data-comment-id='11111111-1111-4111-8111-111111111111']");
    await root.getByRole('button', { name: 'Report' }).click();
    const sheet = page.locator('.ui-sheet');
    for (const reason of ['Harassment or bullying', 'Sexual content', 'Threat or violence', 'Personal information', 'Spam', 'Another safety issue']) {
        await expect(sheet.getByText(reason, { exact: true })).toBeVisible();
    }
    await sheet.getByText('Threat or violence').click();
    await sheet.getByRole('button', { name: 'Report and hide' }).click();
    await expect(root).toHaveCount(0);

    // Escape closes the screen; reopening within 30 s shows the cached thread without a spinner.
    await page.keyboard.press('Escape');
    await expect(comments).toBeHidden();
    const loadsBefore = await page.evaluate(() => window.__commentLoads);
    await poll.getByRole('button', { name: /^Open \d+ comments$/ }).click();
    await expect(comments.getByText('Showing up right away.')).toBeVisible();
    await expect(comments.getByText('Loading comments…')).toHaveCount(0);
    expect(await page.evaluate(() => window.__commentLoads)).toBe(loadsBefore + 1);
});

test('the comments screen keeps keyboard focus inside it', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'School', exact: true }).click();
    await page.locator("[data-feed-detail='9003']").getByRole('button', { name: 'Open 4 comments' }).click();
    const comments = page.getByRole('dialog', { name: 'Comments' });
    await expect(comments.getByText('This one is so accurate.')).toBeVisible();
    for (let step = 0; step < 25; step += 1) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#commentsDialog')))).toBe(true);
    }
    const actions = await comments.locator('.comment-actions > button').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    for (const height of actions) expect(height).toBeGreaterThanOrEqual(44);
});
