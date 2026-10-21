// Local fixtures only. Start the source app on PARITY_ORIGIN (default :4186).
import { chromium } from 'playwright';
import { syntheticCamera } from '../tests/fixtures/synthetic-camera.js';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
const origin = process.env.PARITY_ORIGIN || 'http://127.0.0.1:4186';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Screenshots require a local fixture server');
const out = fileURLToPath(new URL('../screenshots/parity/', import.meta.url));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
for (const [size, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 1000 }]]) {
    const page = await browser.newPage({ viewport });
    await page.route('**/api/v1/**', route => route.abort());
    const shot = async name => {
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `${out}${name}-${size}.png`, scale: 'css', animations: 'disabled' });
    };
    await page.goto(`${origin}/app/?demo=1&signin=1&friends=1&activity=1`);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.locator('#profileCard h3').waitFor(); await shot('after-profile');
    await page.locator('#profilePanel [data-open-friends]').click();
    const friends = page.getByRole('dialog', { name: 'Add Friends', exact: true });
    await friends.locator('[data-friend-row="classmate-1"]').waitFor(); await shot('after-friends'); await shot('after-requests');
    await friends.getByRole('button', { name: 'Suggested', exact: true }).click();
    await friends.locator('[data-friend-row="classmate-4"]').waitFor(); await shot('after-suggested');
    await friends.getByRole('button', { name: 'Friends options', exact: true }).click();
    await friends.getByRole('button', { name: 'Privacy', exact: true }).click();
    await friends.getByRole('button', { name: /Who can add you/ }).click();
    await friends.getByRole('radio', { name: /^School & contacts/ }).waitFor(); await shot('after-friend-privacy');
    await friends.getByRole('button', { name: 'Back', exact: true }).click();
    await friends.getByRole('button', { name: 'Back', exact: true }).click();
    await friends.getByRole('button', { name: 'My link & QR code', exact: true }).click();
    await friends.getByRole('img', { name: 'QR code for your Add me link' }).waitFor(); await shot('after-qr');
    await friends.getByRole('button', { name: 'Back', exact: true }).click();
    await friends.locator('[data-friend-profile="classmate-1"]').click();
    const profile = page.getByRole('dialog', { name: 'Profile', exact: true });
    await profile.getByRole('button', { name: 'Ask anonymously', exact: true }).waitFor(); await shot('after-peer-profile');
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const context = DemoAPI.prototype.getPublicAskContext;
        DemoAPI.prototype.getPublicAskContext = async function (...args) {
            const recipient = await this.getProfile('classmate-1');
            return { ...await context.apply(this, args), recipient_username: 'maya_c', recipient_profile_picture_url: recipient.profile_picture_url };
        };
    });
    await profile.getByRole('button', { name: 'Ask anonymously', exact: true }).click();
    const composer = page.getByRole('dialog', { name: 'Ask anonymously', exact: true });
    await composer.getByLabel('Your question').fill('What made you smile today?'); await shot('after-ask-compose');
    await composer.getByRole('button', { name: 'Send question', exact: true }).click();
    await composer.getByRole('button', { name: 'Open Sent', exact: true }).click();
    await page.locator('[data-anonymous-sent]').waitFor(); await shot('after-ask-sent');
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.locator('.chat-list .chat-row').first().waitFor(); await shot('after-chats');
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    const bell = page.getByRole('dialog', { name: 'Notifications', exact: true });
    await bell.getByRole('button', { name: /Valid gifted you aura/ }).waitFor(); await shot('after-bell');
    await bell.getByRole('button', { name: 'Close notifications', exact: true }).click();
    // Same names and list contents as the native comparison harness.
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const person = (id, name, username, school = 'Lincoln High School') => ({ user_id: id, name, first_name: name.split(' ')[0], last_name: name.split(' ')[1], username, school_name: school });
        DemoAPI.prototype.getFriends = async () => ({ friends: [person('native-maya', 'Maya Patel', 'mayap'), person('native-leo', 'Leo Garcia', 'leog')], total: 2 });
        DemoAPI.prototype.getPeopleRequests = async () => ({ can_add_people: true, incoming: [], outgoing: [person('native-sam', 'Sam Lee', 'samlee'), person('native-ava', 'Ava Chen', 'avachen', 'Cornell University')] });
        DemoAPI.prototype.getFriendSuggestions = async () => ({ enabled: true, suggestions: [{ ...person('native-sofia', 'Sofia Rivera', 'sofiar'), reason: 'grade', label: 'Your grade' }] });
    });
    await page.locator('.chat-page-header [data-open-friends]').click();
    await friends.locator('[data-friend-row="native-maya"]').waitFor(); await shot('compare-friends-pwa');
    await friends.getByRole('button', { name: 'Suggested', exact: true }).click();
    await friends.locator('[data-friend-row="native-sofia"]').waitFor(); await shot('compare-suggested-pwa');
    await friends.getByRole('button', { name: 'Close Add Friends', exact: true }).click();
    await page.evaluate(async () => {
        const { openParentView } = await import('/app/parent-access.js');
        openParentView({ api: { request: async path => path.endsWith('/children') ? { children: [{ user_id: 'fixture-child', first_name: 'Maya', scope: 'contacts', permission_status: 'linked', school_contacts_only: true, message_requests_from_anyone: false, activity_status_enabled: true }] } : { chats: [] } }, token: 'parentv1_fixture', escapeHTML: value => String(value || '').replace(/[<>&"]/g, '') });
    });
    const parent = page.getByRole('dialog', { name: 'Parent view', exact: true });
    await parent.getByRole('button', { name: 'Settings', exact: true }).click();
    await parent.locator('[data-parent-privacy]').first().waitFor(); await shot('after-parent-settings'); await shot('compare-parent-settings-pwa');
    await parent.locator('[data-parent-privacy="school_contacts_only"]').click(); await shot('compare-parent-add-pwa');
    await page.close();
    const cameraPage = await browser.newPage({ viewport });
    await cameraPage.route('**/api/v1/**', route => route.abort());
    await syntheticCamera(cameraPage);
    await cameraPage.goto(`${origin}/app/?demo=1&signin=1`);
    await cameraPage.evaluate(async () => {
        const { openParentApproval } = await import('/app/parent-approval.js');
        void openParentApproval({ api: { request: async path => path.endsWith('/policy') ? { enabled: true, version: 'fixture', title: 'Parent permission', account: "Your child's account information", sharing: 'Their messages, photos and activity', privacy: 'Private storage and moderation', choices: 'Permission and optional monitoring are separate', statement: 'I am their parent or guardian and agree' } : { status: 'draft', expires_at: new Date(Date.now() + 3600000).toISOString() } }, age: 12, deviceId: 'screenshot-fixture', escapeHTML: value => String(value || '').replace(/[<>&"]/g, '') });
    });
    const approval = cameraPage.getByRole('dialog', { name: 'Parent permission', exact: true });
    await approval.getByRole('checkbox').check();
    await approval.getByRole('button', { name: 'Give permission', exact: true }).click();
    await approval.getByRole('button', { name: 'Skip monitoring', exact: true }).click();
    await approval.getByRole('button', { name: 'Take photo', exact: true }).click();
    await approval.getByRole('img', { name: 'Your approval photo' }).waitFor(); await cameraPage.evaluate(() => document.fonts.ready);
    await cameraPage.screenshot({ path: `${out}after-parent-photo-${size}.png`, scale: 'css', animations: 'disabled' });
    await approval.getByRole('button', { name: 'Back to age selection', exact: true }).click();
    await cameraPage.close();
    const collegePage = await browser.newPage({ viewport });
    await collegePage.route('**/api/v1/**', route => route.abort());
    await collegePage.goto(`${origin}/app/?demo=1&signup=1`);
    await collegePage.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        DemoAPI.prototype.getNearbySchools = async () => ({ schools: [{ id: 701, name: 'Fixture University', city: 'Test City', state: 'CA', is_college: true }] });
        DemoAPI.prototype.getSchoolKind = async school_id => ({ school_id, is_college: true });
    });
    const signup = collegePage.locator('#signupDialog');
    await signup.locator('[data-signup-age="20"]').click();
    await signup.getByRole('button', { name: 'Get Started!' }).click();
    await signup.getByRole('button', { name: 'Choose Friends', exact: true }).click();
    await signup.getByRole('button', { name: 'Continue', exact: true }).click();
    await signup.getByPlaceholder('School, city, or ZIP').fill('90210');
    await signup.getByRole('option', { name: /Fixture University/ }).click();
    await signup.getByRole('button', { name: 'Continue', exact: true }).click();
    await signup.getByRole('radio', { name: /^Class of/ }).first().waitFor();
    await collegePage.evaluate(() => document.fonts.ready);
    await collegePage.screenshot({ path: `${out}after-college-years-${size}.png`, scale: 'css', animations: 'disabled' });
    await signup.getByRole('radio', { name: /^Class of/ }).first().click();
    await signup.getByRole('button', { name: 'Continue', exact: true }).click();
    await signup.getByPlaceholder('Search majors').fill('engineering');
    await signup.getByRole('radio', { name: 'Mechanical Engineering', exact: true }).waitFor();
    await collegePage.screenshot({ path: `${out}after-college-major-${size}.png`, scale: 'css', animations: 'disabled' });
    await collegePage.close();
}
// Capture the review composites only after explicitly selecting each flow.
// Navigating to a hash alone does not reload an already-open browser document.
const comparisonPage = await browser.newPage({ viewport: { width: 1320, height: 1100 } });
await comparisonPage.goto(`${origin}/screenshots/parity/comparison.html`);
for (const [flow, name] of [['friends', 'friends'], ['parent', 'parent'], ['privacy', 'privacy']]) {
    await comparisonPage.locator(`[data-flow="${flow}"]`).click();
    await comparisonPage.locator(`[data-flow="${flow}"][aria-pressed="true"]`).waitFor();
    await comparisonPage.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(img => img.decode())); });
    await comparisonPage.screenshot({ path: `${out}side-by-side-${name}.png`, fullPage: true, scale: 'css', animations: 'disabled' });
}
await browser.close();
