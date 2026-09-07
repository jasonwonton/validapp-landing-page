// Read-only live checks: synthetic camera only, no account login/upload/post.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
const invitation = process.env.STAGING_PREVIEW_URL;
assert(invitation, 'Set STAGING_PREVIEW_URL');
assert.equal(new URL(invitation).origin, 'https://staging.validapp.lol');
const api = 'https://api.six7.lol';
for (const path of ['/health', '/ready']) {
    const response = await fetch(`${api}${path}`);
    assert.equal(response.status, 200, path);
}
const schema = await fetch(`${api}/openapi.json`).then(r => r.json());
const path = '/api/v1/users/{user_id}/daily-highlight-uploads/{media_asset_id}/content';
const variant = schema.paths[path].put.parameters.find(p => p.name === 'variant');
assert.equal(variant?.schema.default, 'primary');
assert.equal(variant?.schema.pattern, '^(primary|secondary)$');
console.log('PASS: live API health/readiness and additive secondary upload contract');
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
    await page.goto(invitation);
    const version = await page.locator('meta[name="valid-app-version"]').getAttribute('content');
    assert.equal(version, process.env.STAGING_EXPECTED_VERSION || 'web-v79');
    for (const file of ['app/chat/index.js', 'app/chat/store.js', 'app/chat/models.js', 'app/live-camera.js', 'app/chat/styles.css', 'app/styles.css', 'app/preferences.js', 'app/ui-icons.js', 'app/api.js']) {
        const response = await page.request.get(new URL(`/${file}`, invitation).href);
        assert.equal(response.status(), 200);
        const hash = data => createHash('sha256').update(data).digest('hex');
        assert.equal(hash(await response.body()), hash(await readFile(new URL(`../dist/${file}`, import.meta.url))), file);
    }
    const result = await page.evaluate(async () => {
        const { createLiveCamera } = await import('/app/live-camera.js');
        const streams = [];
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async constraints => {
            const stream = await original(constraints);
            streams.push(stream);
            return stream;
        };
        const container = document.createElement('section');
        document.body.append(container);
        let resolve;
        const captured = new Promise(done => resolve = done);
        const camera = createLiveCamera({ container, onCapture: resolve, onFallback() { throw new Error('Unexpected fallback'); } });
        camera.open();
        const deadline = Date.now() + 15000;
        while (container.querySelector('[data-camera-shutter]').disabled) {
            if (Date.now() > deadline) throw new Error('Synthetic camera did not start');
            await new Promise(done => setTimeout(done, 50));
        }
        const fallbackHidden = container.querySelector('[data-camera-library]').hidden;
        container.querySelector('[data-camera-shutter]').click();
        let timeout;
        try {
            const files = await Promise.race([captured, new Promise((_, reject) => timeout = setTimeout(() => reject(new Error('Capture timeout')), 15000))]);
            return { fallbackHidden, files: files.map(file => ({ type: file.type, bytes: file.size })), tracksStopped: streams.flatMap(s => s.getTracks()).every(t => t.readyState === 'ended') };
        } finally { clearTimeout(timeout); camera.close(); container.remove(); }
    });
    assert.equal(result.fallbackHidden, true);
    assert.equal(result.files.length, 2);
    assert(result.files.every(file => file.type === 'image/jpeg' && file.bytes > 0 && file.bytes <= 8 * 1024 * 1024));
    assert.equal(result.tracksStopped, true);
    console.log('PASS: exact deployed module hashes, one-shutter two-view synthetic camera, no default picker, released tracks');
    // Exercise the deployed UI under its real CSP with an in-memory adapter.
    // No real account, chat, read receipt, sticker send, or upload is involved.
    const hierarchy = await page.evaluate(async () => {
        const { createChatsView } = await import('/app/chat/index.js');
        const today = new Date();
        const ledgerDate = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
        const chat = { id: 'synthetic-chat', display_name: 'Synthetic chat', membership_status: 'accepted', accepted_count: 2, moment_streak: 3 };
        const row = { ledger_date: ledgerDate, viewer_has_posted_today: true, viewer_has_shared: true, view_gate_locked: false, posted_count: 1, eligible_count: 2, entries: [{ first_name: 'Fixture', has_posted: true, image_url: '/assets/app/rocket.webp', entry_id: 'synthetic-entry' }] };
        const root = document.createElement('section');
        document.body.replaceChildren(root);
        const api = {
            assetURL: value => new URL(value, location.origin).href,
            getChats: async () => ({ items: [chat] }),
            getChat: async () => ({ chat, members: [] }),
            getChatMessages: async () => ({ items: [] }),
            getChatDailyRow: async () => row,
            markChatRead: async () => { throw new Error('Unexpected synthetic read receipt'); },
            getStickers: async () => ({ stickers: [{ id: 'synthetic-sticker', image_url: '/assets/app/rocket.webp' }] }),
        };
        const view = createChatsView({ root, api, getUser: () => ({ id: 'synthetic-user' }), getConfig: () => ({ enable_chats: true, enable_web_chats: true, enable_chat_daily_ledger: true, enable_web_mementos: true }) });
        await view.activate({});
        await view.openChat(chat.id, { updateHistory: false });
        const inlineHidden = root.querySelector('.chat-daily-row').classList.contains('hidden');
        const button = root.querySelector('[data-open-memento-gallery]');
        const header = button.textContent;
        button.click();
        const galleryOpened = root.querySelector('[data-memento-gallery-dialog]').open;
        const dates = root.querySelectorAll('[data-memento-date]').length;
        root.querySelector('[data-close-memento-gallery]').click();
        root.querySelector('[data-open-stickers]').click();
        const stickersOpened = root.querySelector('[data-sticker-library-dialog]').open;
        root.querySelector('[data-close-stickers]').click();
        root.querySelector('[data-open-chat-media]').click();
        const camera = root.querySelector('[data-chat-camera]');
        const waitFor = async condition => {
            const deadline = Date.now() + 15000;
            while (!condition()) {
                if (Date.now() > deadline) throw new Error('Chat camera timed out');
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        };
        await waitFor(() => !camera.querySelector('[data-camera-shutter]').disabled);
        const tracks = camera.querySelector('video').srcObject.getTracks();
        camera.querySelector('[data-camera-shutter]').click();
        await waitFor(() => !root.querySelector('.chat-media-publish').disabled);
        const cameraReviewed = Boolean(root.querySelector('.chat-media-preview img')) && camera.hidden;
        const cameraStopped = tracks.every(track => track.readyState === 'ended');
        root.querySelector('[data-close-chat-media]').click();
        await view.beforeSessionEnd();
        return { inlineHidden, header, galleryOpened, dates, stickersOpened, cameraReviewed, cameraStopped };
    });
    assert.deepEqual(hierarchy, { inlineHidden: true, header: '1/23', galleryOpened: true, dates: 7, stickersOpened: true, cameraReviewed: true, cameraStopped: true });
    console.log('PASS: deployed chat hierarchy, streak, history, stickers and single-photo camera/review with stopped tracks (synthetic adapter; no account writes)');
} finally { await browser.close(); }
