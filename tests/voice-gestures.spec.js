import { test, expect } from '@playwright/test';

async function openRoom(page) {
    await page.addInitScript(() => {
        window.voiceStops = 0;
        const stream = {getTracks: () => [{stop() { voiceStops++; }}]};
        Object.defineProperty(navigator, 'mediaDevices', {configurable:true,value:{getUserMedia: async () => stream}});
        class Recorder extends EventTarget {
            static isTypeSupported(type) { return type.startsWith('audio/mp4'); }
            constructor(stream) { super(); this.stream = stream; this.state = 'inactive'; }
            start() { this.state = 'recording'; }
            stop() { this.state = 'inactive'; this.dispatchEvent(new MessageEvent('dataavailable', {data:new Blob(['voice'], {type:'audio/mp4'})})); this.dispatchEvent(new Event('stop')); }
        }
        Object.defineProperty(window, 'MediaRecorder', {value:Recorder,configurable:true});
    });
    await page.goto('/app/?demo=1&signin=1');
    await page.getByRole('button', {name:/^sign in$/i}).click();
    await page.getByRole('button', {name:'Chats',exact:true}).click();
    await page.getByRole('button', {name:/Noah Williams/}).click();
}
async function hold(page) {
    const box = await page.locator('.chat-mic-button').boundingBox();
    const point = {x:box.x + box.width / 2,y:box.y + box.height / 2};
    await page.mouse.move(point.x,point.y); await page.mouse.down();
    await expect(page.getByRole('button', {name:'Stop recording and preview'})).toBeVisible();
    return point;
}
test('hold release creates an unsent preview with a custom player and waveform', async ({page}) => {
    await openRoom(page); await hold(page); await page.mouse.up();
    await expect(page.locator('.chat-voice-player')).toBeVisible();
    await expect(page.locator('.chat-voice-waveform')).toBeVisible();
    await expect(page.locator('[data-send-voice]')).toBeEnabled();
    await page.screenshot({path: test.info().outputPath('voice-preview.png')});
    await page.getByRole('button', {name:'Discard voice message'}).click();
    await expect(page.locator('.chat-voice-inline')).toBeHidden();
});
test('slide left discards without sending and releases microphone tracks', async ({page}) => {
    await openRoom(page); const point = await hold(page);
    await page.mouse.move(point.x - 100,point.y); await page.mouse.up();
    await expect(page.locator('.chat-voice-inline')).toBeHidden();
    expect(await page.evaluate(() => voiceStops)).toBeGreaterThan(0);
    await expect(page.locator('.chat-voice-player')).toBeHidden();
});
test('slide up locks recording until explicit stop; keyboard toggle remains available', async ({page}) => {
    await openRoom(page); const point = await hold(page);
    await page.mouse.move(point.x,point.y - 90); await page.mouse.up();
    await expect(page.locator('.chat-voice-hint')).toHaveText('Recording locked');
    await page.screenshot({path: test.info().outputPath('voice-locked.png')});
    await expect(page.getByRole('button', {name:'Stop recording and preview'})).toBeVisible();
    await page.getByRole('button', {name:'Stop recording and preview'}).click();
    await expect(page.locator('.chat-voice-player')).toBeVisible();
    await page.getByRole('button', {name:'Discard voice message'}).click();
    await page.locator('.chat-mic-button').press('Enter');
    await expect(page.getByRole('button', {name:'Stop recording and preview'})).toBeVisible();
});
