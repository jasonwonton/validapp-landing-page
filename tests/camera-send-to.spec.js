import { expect, test } from "@playwright/test";
import os from "node:os";
import path from "node:path";

// The Camera tab, Send to, Memento fan-out and Stories from the camera
// (iOS CameraTabItem, CaptureSendSheet, MementoAudiencePicker, StoryStrip).
// CAMERA_SHOTS=1 also saves 390×844 screenshots of each step.
// CAMERA_SHOTS_DARK=1 takes them in dark mode.
const SHOTS = process.env.CAMERA_SHOTS === "1";
const DARK = process.env.CAMERA_SHOTS_DARK === "1";
const shotDir = path.join(os.homedir(), "Desktop/validapp-flows/shots/camera");
async function shot(page, name) {
    if (!SHOTS || test.info().project.name !== "android") return;
    await page.waitForTimeout(400); // Sheets finish sliding in.
    await page.screenshot({ path: path.join(shotDir, `${name}${DARK ? "-dark" : ""}.png`) });
}

test.use({ viewport: { width: 390, height: 844 }, ...(DARK ? { colorScheme: "dark" } : {}) });

async function syntheticCamera(page) {
    await page.addInitScript(() => {
        const make = (facing) => {
            const canvas = document.createElement("canvas");
            canvas.width = 720; canvas.height = 960;
            const context = canvas.getContext("2d");
            let t = 0;
            const paint = () => {
                t += 0.03;
                const gradient = context.createLinearGradient(0, 0, 720, 960);
                gradient.addColorStop(0, facing === "user" ? "#ff9a8b" : "#4facfe");
                gradient.addColorStop(1, facing === "user" ? "#ffd86f" : "#43e97b");
                context.fillStyle = gradient; context.fillRect(0, 0, 720, 960);
                context.fillStyle = "rgba(255,255,255,.85)";
                context.beginPath(); context.arc(360 + Math.sin(t) * 120, 400, 120, 0, Math.PI * 2); context.fill();
            };
            paint();
            const timer = setInterval(paint, 40);
            const stream = canvas.captureStream(25);
            const track = stream.getVideoTracks()[0];
            track.getSettings = () => ({ facingMode: facing, width: 720, height: 960 });
            track.getCapabilities = () => ({});
            track.applyConstraints = async () => {};
            const stop = track.stop.bind(track);
            track.stop = () => { clearInterval(timer); stop(); };
            return stream;
        };
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
            async getUserMedia(constraints) { return constraints.video ? make(constraints.video.facingMode?.ideal || "user") : new MediaStream(); },
            async enumerateDevices() { return []; }, addEventListener() {}, removeEventListener() {},
        } });
    });
}

async function signIn(page, query = "") {
    await page.goto(`/app/?demo=1&signin=1&stories=1${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Chats", exact: true })).toBeVisible({ timeout: 20_000 });
}

// What the demo API was asked to do, recorded on its prototype.
async function recordSends(page) {
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        window.sends = { chats: [], stories: [], mementos: [], created: [] };
        const wrap = (name, record) => {
            const original = DemoAPI.prototype[name];
            DemoAPI.prototype[name] = async function (...args) { record(...args); return original.apply(this, args); };
        };
        wrap("sendChatMessage", (_user, chatId, payload) => { if (payload.media_asset_id) sends.chats.push({ chatId, viewOnce: payload.view_once }); });
        wrap("publishStory", (_user, _asset, payload) => sends.stories.push({ tags: payload.taggedUserIds || [] }));
        wrap("publishDailyHighlight", (_user, _asset, chatIds) => sends.mementos.push(chatIds));
        wrap("createChat", (_user, members) => sends.created.push(members));
    });
}

test.describe("Camera tab and Send to", () => {
    test.beforeEach(async ({ page }) => {
        const supported = await page.evaluate(() => typeof HTMLCanvasElement.prototype.captureStream === "function").catch(() => true);
        test.skip(!supported, "Synthetic camera needs canvas.captureStream");
        test.slow();
        await syntheticCamera(page);
    });

    test("the tab opens the Memento camera while one is due, and Send to fans one Memento out to several chats", async ({ page }) => {
        await signIn(page);
        await recordSends(page);
        const tab = page.getByRole("button", { name: "Camera", exact: true });
        await expect(tab).toBeVisible();
        await expect(page.locator("#cameraTabDot")).toBeVisible();
        await expect(tab).toHaveAttribute("aria-description", "2 chats are still waiting for today's Memento");
        await shot(page, "01-camera-tab-dot");
        await tab.click();
        const memento = page.getByRole("dialog", { name: "Today's Memento" });
        await expect(memento.getByRole("group", { name: "Camera mode" })).toBeVisible();
        await expect(memento.getByRole("button", { name: "Memento", exact: true })).toHaveAttribute("aria-pressed", "true");
        await expect(memento.getByRole("button", { name: "Take the back photo" })).toBeEnabled();
        await shot(page, "02-memento-camera");
        await memento.getByRole("button", { name: "Take the back photo" }).click();
        await expect(memento.getByRole("button", { name: "Take the front photo" })).toBeEnabled();
        await memento.getByRole("button", { name: "Take the front photo" }).click();
        const send = memento.locator(".memento-publish");
        await expect(send).toBeEnabled();
        await expect(send).toHaveText("Send");
        await shot(page, "03-memento-review");
        await send.click();

        const sheet = page.getByRole("dialog", { name: "Send to" });
        await expect(sheet.getByRole("button", { name: "My Story", exact: true })).toHaveCount(0);
        await expect(sheet.getByRole("region", { name: "Save your streaks" }).getByRole("button", { name: "Mateo Lee", exact: true })).toBeVisible();
        await expect(sheet.getByRole("region", { name: "Best friends" }).getByRole("button", { name: "Weekend Crew", exact: true })).toBeVisible();
        const noah = sheet.getByRole("button", { name: "Noah Williams", exact: true });
        await expect(noah).toBeDisabled();
        await expect(noah).toContainText("Already shared today");
        await expect(sheet.locator(".send-to-send")).toHaveText("Choose where to send");
        await expect(sheet.locator(".send-to-send")).toBeDisabled();
        await shot(page, "04-memento-send-to");
        await sheet.getByRole("button", { name: "Select all" }).click();
        await expect(sheet.getByRole("button", { name: "Deselect all" })).toBeVisible();
        await expect(sheet.locator(".send-to-send")).toHaveText("Send to 2");
        await expect(sheet.locator(".send-to-summary")).toHaveText("Mateo Lee, Weekend Crew");
        await shot(page, "05-memento-select-all");
        await sheet.locator(".send-to-send").click();
        await expect(sheet).toBeHidden();
        await expect(memento).toBeHidden();
        await expect.poll(() => page.evaluate(() => sends.mementos)).toEqual([["chat-mateo", "chat-friends"]]);
        await expect(page.locator("#cameraTabDot")).toBeHidden();
        await expect(tab).toHaveAttribute("aria-description", "Take a photo or video and choose who gets it");

        // No Memento due: the everyday camera, without the mode bar.
        await tab.click();
        const camera = page.getByRole("dialog", { name: "Send media" });
        await expect(camera.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
        await expect(camera.getByRole("group", { name: "Camera mode" })).toBeHidden();
    });

    test("the Memento cap comes from /config and the mode bar switches to the everyday camera", async ({ page }) => {
        await signIn(page, "&mementocap=1");
        await page.getByRole("button", { name: "Camera", exact: true }).click();
        const memento = page.getByRole("dialog", { name: "Today's Memento" });
        await memento.getByRole("button", { name: "Camera", exact: true }).click();
        const camera = page.getByRole("dialog", { name: "Send media" });
        await expect(camera.getByRole("button", { name: "Camera", exact: true })).toHaveAttribute("aria-pressed", "true");
        await camera.getByRole("button", { name: "Memento", exact: true }).click();
        await expect(memento.getByRole("button", { name: "Take the back photo" })).toBeEnabled();
        await memento.getByRole("button", { name: "Take the back photo" }).click();
        await expect(memento.getByRole("button", { name: "Take the front photo" })).toBeEnabled();
        await memento.getByRole("button", { name: "Take the front photo" }).click();
        await memento.locator(".memento-publish").click();
        const sheet = page.getByRole("dialog", { name: "Send to" });
        await sheet.getByRole("button", { name: "Weekend Crew", exact: true }).click();
        await expect(sheet.getByText("You can send to 1 at a time.")).toBeVisible();
        await expect(sheet.getByRole("button", { name: "Mateo Lee", exact: true })).toBeDisabled();
        await expect(sheet.locator(".send-to-send")).toHaveText("Send to Weekend Crew");
    });

    test("shoot-first: Save and Send, then My Story, a new chat and the bar copy, queued so the camera closes at once", async ({ page }) => {
        await signIn(page);
        await page.evaluate(() => localStorage.setItem(`valid.mementoPosted.demo-user`, JSON.stringify({ date: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })(), chatIds: ["chat-friends", "chat-mateo"] })));
        await page.reload();
        await page.getByRole("button", { name: /^sign in$/i }).click().catch(() => null);
        await expect(page.getByRole("button", { name: "Camera", exact: true })).toBeVisible({ timeout: 20_000 });
        await recordSends(page);
        await expect(page.locator("#cameraTabDot")).toBeHidden();
        await page.getByRole("button", { name: "Camera", exact: true }).click();
        const camera = page.getByRole("dialog", { name: "Send media" });
        await expect(camera.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
        await shot(page, "06-everyday-camera");
        await camera.getByRole("button", { name: "Take photo", exact: true }).click();
        const send = camera.locator(".chat-media-publish");
        await expect(send).toBeEnabled();
        await expect(camera.locator("[data-send-to-chip]")).toBeHidden();
        await expect(camera.getByRole("button", { name: "Save" })).toBeVisible();
        // Stickers open with no chat behind the camera.
        await camera.getByRole("button", { name: "Open My Stickers" }).click();
        const stickers = page.getByRole("dialog", { name: "My Stickers" });
        await expect(stickers).toBeVisible();
        await expect(stickers.getByText("Choose a sticker to add to this photo.")).toBeVisible();
        await stickers.getByRole("button", { name: "Close" }).click();
        await expect(stickers).toBeHidden();
        // ①/∞ is on this camera too: Keep in chat sends chats that stay.
        const viewOnce = camera.getByRole("switch", { name: "View once" });
        await expect(viewOnce).toHaveAttribute("aria-checked", "true");
        await expect(send).toContainText("View once");
        await viewOnce.click();
        await expect(viewOnce).toHaveAttribute("aria-checked", "false");
        await expect(send).toContainText("Keep in chat");
        await shot(page, "07-shoot-first-review");
        // Words and arrow sit together in the middle of the pill; Save lines up with it.
        const pill = await send.boundingBox(), title = await send.locator(".send-pill-copy").boundingBox(), arrow = await send.locator("svg").boundingBox();
        expect(Math.abs((title.x + arrow.x + arrow.width) / 2 - (pill.x + pill.width / 2))).toBeLessThan(3);
        const circle = await camera.locator("[data-save-chat-media] .review-save-circle").boundingBox();
        expect(Math.abs((circle.y + circle.height / 2) - (pill.y + pill.height / 2))).toBeLessThan(2);
        await send.click();

        const sheet = page.getByRole("dialog", { name: "Send to" });
        const story = sheet.getByRole("button", { name: "My Story", exact: true });
        await expect(story).toContainText("Your school sees it for 24 hours");
        await expect(story).toHaveAttribute("aria-pressed", "false");
        await expect(sheet.getByRole("searchbox", { name: "Search chats and people" })).toBeVisible();
        await expect(sheet.getByRole("region", { name: "Start a chat with" })).toBeVisible();
        await expect(sheet.locator(".send-to-send")).toHaveText("Choose where to send");
        await shot(page, "08-send-to");
        await story.click();
        await expect(sheet.locator(".send-to-send")).toHaveText("Post to My Story");
        await expect(sheet.getByRole("button", { name: "Tag classmates" })).toBeVisible();
        await sheet.getByRole("searchbox", { name: "Search chats and people" }).fill("maya");
        await sheet.getByRole("button", { name: "Maya Chen", exact: true }).click();
        await expect(sheet.locator(".send-to-send")).toHaveText("Post + send to Maya Chen");
        await shot(page, "09-post-and-send-to-maya");
        await sheet.getByRole("searchbox", { name: "Search chats and people" }).fill("");
        await sheet.getByRole("button", { name: "Noah Williams", exact: true }).click();
        await sheet.getByRole("button", { name: "Weekend Crew", exact: true }).click();
        await expect(sheet.locator(".send-to-send")).toHaveText("Post + send to 3");
        await expect(sheet.locator(".send-to-summary")).toHaveText("My Story, Maya Chen +2");
        await expect(sheet.locator(".send-to-caption")).toHaveText("Stays in the chats");
        const bar = await sheet.locator(".send-to-send").boundingBox(), label = await sheet.locator(".send-to-send-title").evaluate((node) => {
            const range = document.createRange(); range.selectNodeContents(node); const box = range.getBoundingClientRect(); return { x: box.x, width: box.width };
        });
        expect(Math.abs(label.x + label.width / 2 - (bar.x + bar.width / 2))).toBeLessThan(3);
        await shot(page, "10-post-and-send-to-3");
        await sheet.locator(".send-to-send").click();
        await expect(sheet).toBeHidden();
        await expect(camera).toBeHidden();
        await expect.poll(() => page.evaluate(() => sends.created)).toEqual([["classmate-1"]]);
        await expect.poll(() => page.evaluate(() => sends.stories.length)).toBe(1);
        await expect.poll(() => page.evaluate(() => sends.chats.length)).toBe(3);
        expect(await page.evaluate(() => sends.chats.every((send) => send.viewOnce === false))).toBe(true);
    });

    test("the Story rail + opens the camera with My Story ticked, tags classmates, and shows Posting… then Tap to retry", async ({ page }) => {
        await signIn(page);
        await recordSends(page);
        await page.evaluate(async () => {
            const { DemoAPI } = await import("/app/demo-api.js");
            const publish = DemoAPI.prototype.publishStory;
            window.storyGate = null;
            DemoAPI.prototype.publishStory = async function (...args) {
                if (window.refuseStory) { const error = new Error("Story refused"); error.status = 422; throw error; }
                if (window.holdStory) await new Promise((resolve) => { window.storyGate = resolve; });
                return publish.apply(this, args);
            };
            window.holdStory = true;
        });
        await page.getByRole("button", { name: "Add another Story" }).click();
        const camera = page.getByRole("dialog", { name: "Send media" });
        await expect(camera.getByRole("group", { name: "Camera mode" })).toBeHidden();
        await expect(camera.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
        await camera.getByRole("button", { name: "Take photo", exact: true }).click();
        await camera.locator(".chat-media-publish").click();
        const sheet = page.getByRole("dialog", { name: "Send to" });
        await expect(sheet.getByRole("button", { name: "My Story", exact: true })).toHaveAttribute("aria-pressed", "true");
        await expect(sheet.locator(".send-to-send")).toHaveText("Post to My Story");
        await sheet.getByRole("button", { name: "Tag classmates" }).click();
        const tags = page.getByRole("dialog", { name: "Tag classmates" });
        await expect(tags).toContainText("They'll get a notification when your Story posts.");
        await expect(tags.locator(".send-to-send")).toHaveText("No tags");
        await tags.getByRole("button", { name: /Ava Patel/ }).click();
        await tags.getByRole("button", { name: /Eli Brooks/ }).click();
        await expect(tags.locator(".send-to-send")).toHaveText("Tag 2");
        await shot(page, "11-tag-classmates");
        await tags.locator(".send-to-send").click();
        await expect(sheet.getByRole("button", { name: "Tagged 2" })).toBeVisible();
        await shot(page, "12-story-send-to");
        await sheet.locator(".send-to-send").click();
        await expect(camera).toBeHidden();
        const own = page.locator(".own-story .story-author-button");
        await expect(own).toContainText("Posting…");
        await expect(own).toHaveAttribute("aria-label", "Your Story, Posting…");
        await shot(page, "13-rail-posting");
        await page.evaluate(() => { window.holdStory = false; window.storyGate?.(); });
        await expect(own).toContainText("Your Story");
        await expect.poll(() => page.evaluate(() => sends.stories)).toEqual([{ tags: ["classmate-3", "classmate-4"] }]);

        // A refused post waits for "Tap to retry", then Try again posts it.
        await page.evaluate(() => { window.refuseStory = true; });
        await page.getByRole("button", { name: "Add another Story" }).click();
        await expect(camera.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
        await camera.getByRole("button", { name: "Take photo", exact: true }).click();
        await camera.locator(".chat-media-publish").click();
        await sheet.locator(".send-to-send").click();
        await expect(own).toContainText("Tap to retry");
        await shot(page, "14-rail-tap-to-retry");
        await own.click();
        const failed = page.getByRole("dialog", { name: "Your Story didn't post" });
        await expect(failed.getByRole("button", { name: "Try again" })).toBeVisible();
        await expect(failed.getByRole("button", { name: "Discard" })).toBeVisible();
        await shot(page, "15-story-didnt-post");
        await page.evaluate(() => { window.refuseStory = false; });
        await failed.getByRole("button", { name: "Try again" }).click();
        await expect(own).toContainText("Your Story");
        await expect.poll(() => page.evaluate(() => sends.stories.length)).toBe(2);
    });

    test("the chat review chip's + keeps this chat ticked and adds My Story and other chats", async ({ page }) => {
        await signIn(page);
        await recordSends(page);
        await page.getByRole("button", { name: "Chats", exact: true }).click();
        await page.getByRole("button", { name: /Noah Williams/ }).first().click();
        await page.getByRole("button", { name: "Open camera" }).click();
        const camera = page.getByRole("dialog", { name: "Send media" });
        await expect(camera.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
        await camera.getByRole("button", { name: "Take photo", exact: true }).click();
        const chip = camera.getByRole("button", { name: "Sending to Noah Williams" });
        await expect(chip).toHaveAttribute("aria-description", "Add My Story or more people");
        await shot(page, "16-chat-review-chip");
        await chip.click();
        const sheet = page.getByRole("dialog", { name: "Send to" });
        const noah = sheet.getByRole("button", { name: "Noah Williams", exact: true });
        await expect(noah).toHaveAttribute("aria-pressed", "true");
        await expect(noah).toContainText("You’re here");
        await expect(sheet.locator(".send-to-caption")).toHaveText("Chats open once");
        await expect(sheet.locator(".send-to-send")).toHaveText("Send to Noah Williams");
        await noah.click();
        await expect(noah).toHaveAttribute("aria-pressed", "true");
        await sheet.getByRole("button", { name: "My Story", exact: true }).click();
        await sheet.getByRole("button", { name: "Weekend Crew", exact: true }).click();
        await expect(sheet.locator(".send-to-send")).toHaveText("Post + send to 2");
        await shot(page, "17-chip-send-to");
        await sheet.locator(".send-to-send").click();
        await expect(camera).toBeHidden();
        await expect.poll(() => page.evaluate(() => sends.chats.map((send) => send.chatId).sort())).toEqual(["chat-friends", "chat-noah"]);
        await expect.poll(() => page.evaluate(() => sends.stories.length)).toBe(1);
    });
});
