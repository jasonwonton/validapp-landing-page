import { expect, test } from '@playwright/test';
async function schools(page, mode = 'college') {
    await page.goto('/app/?demo=1&signup=1');
    await page.evaluate(async mode => {
        const { DemoAPI } = await import('/app/demo-api.js');
        DemoAPI.prototype.getNearbySchools = async () => ({ schools: [{ id: 701, name: 'Fixture College', city: 'Test City', state: 'CA', min_grade: 9, max_grade: 12, is_college: false }, { id: 702, name: 'Fixture High School', city: 'Test City', state: 'CA', min_grade: 9, max_grade: 12 }], zip_code: '90210' });
        DemoAPI.prototype.getSchoolKind = async id => {
            if (mode === 'stale' && Number(id) === 701) return new Promise(resolve => { window.resolveOldKind = () => resolve({ school_id: 701, is_college: true }); });
            if (mode === 'retry' && !window.kindRetried) { window.kindRetried = true; throw new Error('Fixture offline'); }
            return { school_id: id, is_college: Number(id) === 701 };
        };
    }, mode);
    const dialog = page.locator('#signupDialog');
    await dialog.locator('[data-signup-age="20"]').click();
    await dialog.getByRole('button', { name: 'Get Started!' }).click();
    await dialog.getByRole('button', { name: 'Choose Friends', exact: true }).click();
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await dialog.getByPlaceholder('School, city, or ZIP').fill('90210');
    await expect(dialog.locator('[data-signup-school]')).toHaveCount(2);
    return dialog;
}
async function throughPasskey(dialog) {
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    if (await dialog.getByRole('heading', { name: 'What are you studying?' }).isVisible()) await dialog.getByRole('button', { name: 'Skip', exact: true }).click();
    await dialog.getByLabel('Phone number').fill('4155550123');
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await dialog.getByLabel('First name').fill('Taylor');
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await dialog.getByLabel('Last name').fill('Jordan');
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await dialog.getByLabel('Username').fill('kind_fixture');
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await dialog.getByRole('radio', { name: 'Non-binary', exact: true }).click();
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await dialog.getByRole('button', { name: 'Skip for now', exact: true }).click();
}
async function chooseYear(dialog) {
    await dialog.getByRole('option', { name: /Fixture College/ }).click();
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'When do you graduate?' })).toBeVisible();
    await expect(dialog.locator('[data-signup-grade]')).toHaveCount(8);
    await dialog.locator('[data-signup-grade]').first().click();
}
test('an authoritative college answer replaces stale directory metadata with canonical graduation years', async ({ page }) => {
    const dialog = await schools(page); await chooseYear(dialog);
    await expect(dialog.locator('#signupGrade')).toHaveValue(/^Class of (\d{4}) \(C\/O \1\)$/);
    await throughPasskey(dialog);
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        DemoAPI.prototype.demoSignup = async payload => { window.collegePayload = payload.profile; return { user: { id: 'college-fixture' }, access_token: 'local-fixture' }; };
    });
    await dialog.getByRole('button', { name: 'Create passkey', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Your account is secured' })).toBeVisible();
    expect(await page.evaluate(() => window.collegePayload)).toMatchObject({ school_id: 701, grade: expect.stringMatching(/^Class of \d{4} \(C\/O \d{4}\)$/) });
});
test('a late school-kind answer cannot replace the newly selected high school', async ({ page }) => {
    const dialog = await schools(page, 'stale');
    await dialog.getByRole('option', { name: /Fixture College/ }).click();
    await expect.poll(() => page.evaluate(() => typeof window.resolveOldKind)).toBe('function');
    await dialog.getByRole('option', { name: /Fixture High School/ }).click();
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.evaluate(() => window.resolveOldKind());
    await expect(dialog.getByRole('heading', { name: 'What grade are you in?' })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /Senior/ })).toBeVisible();
    await expect(dialog.locator('[data-signup-grade^="Class of"]')).toHaveCount(0);
});
test('a failed kind lookup offers retry and then renders the server college choices', async ({ page }) => {
    const dialog = await schools(page, 'retry');
    await dialog.getByRole('option', { name: /Fixture College/ }).click();
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await dialog.getByRole('button', { name: 'Retry school lookup', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'When do you graduate?' })).toBeVisible();
    await expect(dialog.locator('[data-signup-grade^="Class of"]')).toHaveCount(8);
});
for (const error of ['Graduation years are only for colleges. Select a grade.', 'Select a graduation year from the list.']) {
    test(`grade rejection recovers the submitted school: ${error}`, async ({ page }) => {
        const dialog = await schools(page); await chooseYear(dialog); await throughPasskey(dialog);
        await page.evaluate(async message => { const { DemoAPI } = await import('/app/demo-api.js'); DemoAPI.prototype.demoSignup = async () => { throw Object.assign(new Error(message), { status: 400 }); }; }, error);
        await dialog.getByRole('button', { name: 'Create passkey', exact: true }).click();
        await expect(dialog.locator('#signupGrade')).toHaveValue('');
        await expect(dialog.locator('#signupStatus')).toHaveText(error);
        await expect(dialog.locator('#signupFirstName')).toHaveValue('Taylor');
        if (error.startsWith('Graduation')) await expect(dialog.getByRole('radio', { name: /Senior/ })).toBeVisible();
        else await expect(dialog.locator('[data-signup-grade^="Class of"]')).toHaveCount(8);
    });
    test(`an old submission rejection leaves the new school and grade alone: ${error}`, async ({ page }) => {
        const dialog = await schools(page); await chooseYear(dialog); await throughPasskey(dialog);
        await page.evaluate(async message => { const { DemoAPI } = await import('/app/demo-api.js'); DemoAPI.prototype.demoSignup = () => new Promise((_, reject) => { window.rejectOldSchool = () => reject(Object.assign(new Error(message), { status: 400 })); }); }, error);
        await dialog.getByRole('button', { name: 'Create passkey', exact: true }).click();
        await expect.poll(() => page.evaluate(() => typeof window.rejectOldSchool)).toBe('function');
        for (let i = 0; i < 10 && !await dialog.getByRole('option', { name: /Fixture High School/ }).isVisible(); i++) await dialog.getByRole('button', { name: 'Back', exact: true }).click();
        await dialog.getByRole('option', { name: /Fixture High School/ }).click();
        await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
        await dialog.getByRole('radio', { name: /Senior/ }).click();
        await page.evaluate(() => window.rejectOldSchool());
        await expect(dialog.locator('#signupGrade')).toHaveValue('Senior');
        await expect(dialog.locator('#signupStatus')).not.toHaveText(error);
    });
}
test('profile grade correction uses the same college-year choices', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => { const { DemoAPI } = await import('/app/demo-api.js'); DemoAPI.prototype.getSchoolKind = async school_id => ({ school_id, is_college: true }); });
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.locator('[data-edit-profile]').click();
    await page.locator('[data-profile-editor="grade"]').click();
    await expect(page.locator('[data-profile-grade^="Class of"]')).toHaveCount(8);
    await page.locator('[data-profile-grade^="Class of"]').first().click();
    await page.locator('[data-profile-done="grade"]').click();
    await expect(page.locator('#profileGradeValue')).toHaveText(/^Class of \d{4} \(C\/O \d{4}\)$/);
    await expect(page.locator('#profileReviewButton')).toBeEnabled();
});
test('school-kind lookup uses the existing public route without child authorization', async ({ page }) => {
    await page.goto('/app/?demo=1&signup=1');
    const reads = [];
    await page.route('**/api/v1/highschools/701/kind', route => { reads.push(route.request().headers()); return route.fulfill({ json: { school_id: 701, is_college: true } }); });
    const result = await page.evaluate(async () => { const { ValidAPI } = await import('/app/api.js'); const api = new ValidAPI(); api.saveSession({ access_token: 'private-child-token', user: { id: 'viewer' } }); return api.getSchoolKind(701); });
    expect(result).toEqual({ school_id: 701, is_college: true });
    expect(reads).toHaveLength(1);
    expect(reads[0].authorization).toBeUndefined();
});
test('a pending school lookup cannot be bypassed by selecting the provisional grade', async ({ page }) => {
    const dialog = await schools(page, 'stale');
    await dialog.getByRole('option', { name: /Fixture College/ }).click();
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await dialog.getByRole('radio', { name: 'Senior', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await expect(dialog.locator('#signupGradeOptions').getByRole('status')).toContainText('Checking school');
    await page.evaluate(() => window.resolveOldKind());
    await expect(dialog.getByRole('heading', { name: 'When do you graduate?' })).toBeVisible();
    await expect(dialog.locator('#signupGrade')).toHaveValue('');
    await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
});
test('college majors use the server catalog, search areas, preserve Back and submit the selected key', async ({ page }) => {
    const dialog = await schools(page); await chooseYear(dialog);
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        DemoAPI.prototype.getMajors = async () => ({ version: 'fixture', areas: [{ key: 'engineering', label: 'Engineering' }], majors: [{ key: 'biomedical_engineering', label: 'Biomedical Engineering', area: 'engineering' }, { key: 'fixture_materials', label: 'Materials Science', area: 'engineering' }] });
        const signup = DemoAPI.prototype.demoSignup;
        DemoAPI.prototype.demoSignup = async function (payload) { window.majorPayload = payload.profile; return signup.call(this, payload); };
    });
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'What are you studying?' })).toBeVisible();
    await expect(dialog.locator('[data-signup-major]')).toHaveCount(2);
    await dialog.getByPlaceholder('Search majors').fill('engineering');
    await expect(dialog.locator('[data-signup-major]')).toHaveCount(2);
    await dialog.getByRole('radio', { name: 'Materials Science', exact: true }).click();
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(dialog.getByRole('radio', { name: 'Materials Science', exact: true })).toHaveAttribute('aria-checked', 'true');
    await throughPasskey(dialog);
    await dialog.getByRole('button', { name: 'Create passkey', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.majorPayload?.major)).toBe('fixture_materials');
});
test('major search has an empty state and Skip works with the offline bundled catalog', async ({ page }) => {
    const dialog = await schools(page); await chooseYear(dialog);
    await page.evaluate(async () => { const { DemoAPI } = await import('/app/demo-api.js'); DemoAPI.prototype.getMajors = async () => { throw new Error('Offline catalog'); }; });
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await dialog.getByPlaceholder('Search majors').fill('not a real major');
    await expect(dialog.locator('#signupGradeOptions').getByRole('status')).toContainText('No match.');
    await expect(dialog.locator('#signupGradeContinue')).toBeDisabled();
    await expect(dialog.locator('#signupGradeContinue')).toBeHidden();
    const skip = await dialog.getByRole('button', { name: 'Skip', exact: true }).boundingBox();
    expect(skip.y + skip.height).toBeLessThanOrEqual(page.viewportSize().height);
    await dialog.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: "What's your phone number?" })).toBeVisible();
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.getByPlaceholder('Search majors').fill('computer science');
    await expect(dialog.getByRole('radio', { name: 'Computer Science', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'When do you graduate?' })).toBeVisible();
});
test('major editing is independent of profile cooldown, fences repeated writes and supports retry and clearing', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const get = DemoAPI.prototype.getProfile;
        DemoAPI.prototype.getProfile = async function (...args) {
            if (!this.collegeFixture) { this.collegeFixture = true; Object.assign(this.profile, { major: 'computer_science', major_label: 'Computer Science', grade: 'Class of 2028 (C/O 2028)', can_change_information: false }); }
            return get.apply(this, args);
        };
        DemoAPI.prototype.getSchoolKind = async school_id => ({ school_id, is_college: true });
        window.majorWrites = [];
        const update = DemoAPI.prototype.updateMajor;
        DemoAPI.prototype.updateMajor = async function (owner, major) { window.majorWrites.push({ owner, major }); if (window.majorWrites.length === 1) return new Promise((_, reject) => { window.rejectMajor = () => reject(new Error('Fixture offline, choose again to retry')); }); return update.call(this, owner, major); };
    });
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page.locator('#profileCard .profile-school-meta')).toContainText('Computer Science · ’28');
    await page.locator('[data-edit-profile]').click();
    const dialog = page.locator('#profileDialog');
    await expect(dialog.locator('[data-profile-editor="grade"]')).toBeDisabled();
    await dialog.locator('[data-profile-editor="major"]').click();
    await dialog.getByPlaceholder('Search majors').fill('biology');
    await dialog.getByPlaceholder('Search majors').press('Enter');
    await expect(dialog.locator('#profileEditorTitle')).toHaveText('Major');
    const biology = dialog.locator('[data-profile-major="biology"]');
    await biology.click();
    await expect(biology).toBeDisabled();
    await expect(dialog.locator('#profileMajorStatus')).toHaveText('Saving…');
    await page.evaluate(() => window.rejectMajor());
    await expect(dialog.locator('#profileMajorStatus')).toContainText('Fixture offline');
    expect(await page.evaluate(() => window.majorWrites)).toHaveLength(1);
    await biology.click();
    await expect(dialog.locator('#profileMajorValue')).toHaveText('Biology');
    await expect(dialog.locator('#profileReviewButton')).toBeDisabled();
    await dialog.locator('[data-profile-editor="major"]').click();
    await dialog.getByRole('button', { name: 'Not set', exact: true }).click();
    await expect(dialog.locator('#profileMajorValue')).toHaveText('Not set');
    await expect(page.locator('#profileCard .profile-school-meta')).not.toContainText('Biology');
    expect(await page.evaluate(() => window.majorWrites.map(row => row.major))).toEqual(['biology', 'biology', null]);
});
test('the major catalog is public and updating a major requires the current account credential', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    const requests = [];
    await page.route('**/api/v1/majors', route => { requests.push({ path: new URL(route.request().url()).pathname, headers: route.request().headers() }); return route.fulfill({ json: { version: 'fixture', majors: [] } }); });
    await page.route('**/api/v1/users/viewer/major', route => { requests.push({ path: new URL(route.request().url()).pathname, method: route.request().method(), body: route.request().postDataJSON(), headers: route.request().headers() }); return route.fulfill({ json: { major: 'biology' } }); });
    await page.evaluate(async () => { const { ValidAPI } = await import('/app/api.js'); const api = new ValidAPI(); api.saveSession({ access_token: 'fixture-child-token', user: { id: 'viewer' } }); await api.getMajors(); await api.updateMajor('viewer', 'biology'); });
    expect(requests).toHaveLength(2);
    expect(requests[0].headers.authorization).toBeUndefined();
    expect(requests[1]).toMatchObject({ method: 'PUT', body: { major: 'biology' }, headers: { authorization: 'Bearer fixture-child-token' } });
});
