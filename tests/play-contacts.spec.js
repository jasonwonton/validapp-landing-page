import { expect, test } from '@playwright/test';

// Play builds its four choices from uploaded contacts plus classmates, like
// PlayViewModel on iOS, and counts them before asking for questions: serving
// questions starts the server's play lock.

const hash = (seed) => String(seed).repeat(64).slice(0, 64);

async function signInWithRoster(page, { classmates, contacts }) {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async ({ classmateCount, contactRows }) => {
        const { DemoAPI } = await import('/app/demo-api.js');
        window.__calls = [];
        window.__answers = [];
        const record = (name) => {
            const original = DemoAPI.prototype[name];
            DemoAPI.prototype[name] = function (...args) {
                window.__calls.push(name);
                return original.apply(this, args);
            };
        };
        const originalClassmates = DemoAPI.prototype.getClassmates;
        DemoAPI.prototype.getClassmates = async function (...args) {
            return (await originalClassmates.apply(this, args)).slice(0, classmateCount);
        };
        DemoAPI.prototype.getAllContacts = async function () {
            this.contacts ||= structuredClone(contactRows);
            return structuredClone(this.contacts);
        };
        const originalAnswer = DemoAPI.prototype.answerQuestion;
        DemoAPI.prototype.answerQuestion = function (...args) {
            window.__answers.push(args[1]);
            return originalAnswer.apply(this, args);
        };
        for (const name of ['getAllContacts', 'getClassmates', 'getPlayQuestions', 'addContacts']) record(name);
    }, { classmateCount: classmates, contactRows: contacts });
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByRole('button', { name: 'Feed', exact: true })).toHaveAttribute('aria-current', 'page');
}

const contact = (seed, name, extra = {}) => ({ phone_number: hash(seed), name, is_six7_user: false, user_id: null, recommendation_strength: 0, vote_count: 0, visibility_boosts: [], ...extra });

test('fewer than four classmates and contacts shows the friends lock and never requests questions', async ({ page }) => {
    await signInWithRoster(page, { classmates: 2, contacts: [contact(1, 'Riley Stone'), contact(2, 'Mom')] });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByText('Add more friends to play Valid.')).toBeVisible();
    await expect(page.getByText('You need at least four classmates or contacts.')).toBeVisible();
    await expect(page.locator('#playCard').getByRole('button', { name: 'Find classmates' })).toBeVisible();
    await expect(page.locator('#playCard').getByRole('button', { name: 'Share an invite' })).toBeVisible();
    const calls = await page.evaluate(() => window.__calls);
    expect(calls).toContain('getAllContacts');
    expect(calls).toContain('getClassmates');
    expect(calls).not.toContain('getPlayQuestions');
});

test('two classmates plus two contacts unlock a round, and questions load only after the roster', async ({ page }) => {
    await signInWithRoster(page, { classmates: 2, contacts: [contact(1, 'Riley Stone'), contact(2, 'Casey Moore')] });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByText('Who would survive longest on a deserted island?')).toBeVisible();
    const names = await page.locator('#playCard .play-card:not(.play-card-leaving) [data-choice]').allTextContents();
    expect(new Set(names)).toEqual(new Set(['Riley Stone', 'Casey Moore', 'Maya Chen', 'Noah Williams']));
    const calls = await page.evaluate(() => window.__calls);
    const questions = calls.indexOf('getPlayQuestions');
    expect(questions).toBeGreaterThan(calls.indexOf('getAllContacts'));
    expect(questions).toBeGreaterThan(calls.indexOf('getClassmates'));
});

test('a vote for a contact not on Valid sends the phone hash, no user id, and all four options', async ({ page }) => {
    await signInWithRoster(page, { classmates: 2, contacts: [contact(1, 'Riley Stone'), contact(2, 'Casey Moore')] });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.locator('#playCard .play-card:not(.play-card-leaving) [data-choice]', { hasText: 'Riley Stone' }).click();
    await expect.poll(() => page.evaluate(() => window.__answers.length)).toBe(1);
    const [vote] = await page.evaluate(() => window.__answers);
    expect(vote).toMatchObject({ question_id: 201, selected_contact_name: 'Riley Stone', selected_contact_phone: hash(1), is_nomination: false });
    expect(vote).not.toHaveProperty('selected_contact_user_id');
    expect(vote.presented_options).toHaveLength(4);
    expect(vote.presented_options).toContainEqual({ phone: hash(1), name: 'Riley Stone' });
    expect(vote.presented_options).toContainEqual({ phone: '', name: 'Maya Chen' });
    if (vote.client_request_id) expect(vote.client_request_id).toMatch(/^[0-9a-f-]{36}$/);
});

test('a contact who is also a classmate appears once', async ({ page }) => {
    await signInWithRoster(page, {
        classmates: 3,
        contacts: [contact(1, 'Maya Chen', { user_id: 'classmate-1', is_six7_user: true })],
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByText('Add more friends to play Valid.')).toBeVisible();
    expect(await page.evaluate(() => window.__calls)).not.toContain('getPlayQuestions');
});

test('syncing contacts from the lock card reports people synced and on Valid, then starts the round', async ({ page }) => {
    await signInWithRoster(page, { classmates: 2, contacts: [contact(9, 'Riley Stone')] });
    await page.evaluate(async () => {
        window.__demoPickedContacts = [
            { name: ['Casey Moore'], tel: ['(415) 555-0112'] },
            { name: ['Jordan Fox'], tel: ['415-555-0113', '+1 415 555 0114'] },
            { name: ['Mom'], tel: ['4155550115'] },
        ];
        const { DemoAPI } = await import('/app/demo-api.js');
        const originalAll = DemoAPI.prototype.getAllContacts;
        DemoAPI.prototype.getAllContacts = async function (...args) {
            const rows = await originalAll.apply(this, args);
            // Jordan's first number belongs to an account.
            return rows.map((row) => row.phone_number.endsWith('4155550113') ? { ...row, is_six7_user: true, user_id: 'jordan-account' } : row);
        };
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByText('Add more friends to play Valid.')).toBeVisible();
    await page.locator('#playCard').getByRole('button', { name: 'Find classmates' }).click();
    const dialog = page.locator('#classmatesDialog');
    // The demo closes the dialog without the real 1.5 s pause; record every status line.
    await page.evaluate(() => {
        window.__statuses = [];
        const status = document.querySelector('#classmatesStatus');
        new MutationObserver(() => window.__statuses.push(status.textContent)).observe(status, { childList: true, characterData: true, subtree: true });
    });
    await dialog.getByRole('button', { name: 'Choose contacts' }).click();
    await expect.poll(() => page.evaluate(() => window.__statuses)).toContain('2 contacts synced. 1 is on Valid. 1 skipped. No messages were sent.');
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Who would survive longest on a deserted island?')).toBeVisible();
    const uploads = await page.evaluate(() => window.__calls.filter((call) => call === 'addContacts').length);
    expect(uploads).toBe(1);
});

test('browsers without the contact picker explain why and offer the invite instead of a dead button', async ({ page }) => {
    await signInWithRoster(page, { classmates: 2, contacts: [] });
    await page.evaluate(() => { window.__demoNoContactPicker = true; });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.locator('#playCard').getByRole('button', { name: 'Find classmates' }).click();
    const dialog = page.locator('#classmatesDialog');
    await expect(dialog.getByRole('button', { name: 'Choose contacts' })).toBeHidden();
    await expect(dialog.locator('#classmatesStatus')).toHaveText(/^(Open Valid in Chrome to add friends from your contacts, or share your invite\.|This browser can't open your contacts\. Share your invite so friends can join you\.)$/);
    await expect(dialog.getByRole('button', { name: 'Share my invite instead' })).toBeVisible();
});
