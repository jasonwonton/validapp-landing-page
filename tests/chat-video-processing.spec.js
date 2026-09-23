import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

// An H.264 clip. Set RENDITION_FIXTURE to a real server rendition to play that.
const TINY_H264_MP4 = "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAN0bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAMgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAp90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAMgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAADIAAAEAAABAAAAAAIXbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAACgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABwm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAYJzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4xMS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAMg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAHcQAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAFAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAOGN0dHMAAAAAAAAABQAAAAEAAAQAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAUAAAABAAAAKHN0c3oAAAAAAAAAAAAAAAUAAALKAAAADAAAAAwAAAAMAAAADAAAABRzdGNvAAAAAAAAAAEAAAOkAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2Mi4zLjEwMAAAAAhmcmVlAAADAm1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAUZYiEADP//t8y+BTNxYnOzIBcnpcAAAAIQZokbEK//sAAAAAIQZ5CeIX/wYEAAAAIAZ5hdEK/xIAAAAAIAZ5jakK/xIE=";

async function videoFixture() {
    return process.env.RENDITION_FIXTURE ? readFile(process.env.RENDITION_FIXTURE) : Buffer.from(TINY_H264_MP4, "base64");
}

// The server never hands a browser the phone's HEVC master: while the H.264
// rendition is made it sends video_url null with video_state "processing",
// and "unavailable" when no rendition will ever exist.
async function seedVideos(page) {
    await page.goto("/app/?demo=1&signin=1");
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        window.__renditionReady = false;
        window.__videoReads = {};
        const base = { chat_id: "chat-noah", sender_user_id: "classmate-2", sender_first_name: "Noah", kind: "video",
            status: "active", viewer_is_sender: false, reaction_count: 0, reaction_summary: {},
            video_thumbnail_url: "../assets/AppIconV2.png", video_duration_ms: 4000,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        const original = DemoAPI.prototype.getChatMessages;
        DemoAPI.prototype.getChatMessages = async function (...args) {
            const response = await original.apply(this, args);
            if (args[1] !== "chat-noah") return response;
            const after = args[2]?.afterSequence ?? null;
            const processing = { ...base, id: "video-processing", room_sequence: 100,
                ...(window.__renditionReady
                    ? { video_url: "https://media.example/renditions/web.mp4", video_state: "ready" }
                    : { video_url: null, video_state: "processing" }) };
            const gone = { ...base, id: "video-unavailable", room_sequence: 101, video_url: null, video_state: "unavailable" };
            for (const message of [processing, gone]) {
                if (after === null || message.room_sequence > after) response.items.push(message);
            }
            if (after !== null) window.__videoReads[after] = (window.__videoReads[after] || 0) + 1;
            return response;
        };
    });
    await page.route("https://media.example/renditions/web.mp4", async (route) => {
        await route.fulfill({ status: 200, contentType: "video/mp4", body: await videoFixture() });
    });
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
}

test("a processing video waits, then plays its H.264 rendition", async ({ page }) => {
    await seedVideos(page);
    const bubble = page.locator('[data-open-chat-media-message="video-processing"]');
    await expect(bubble.locator(".chat-video-status")).toHaveText("Processing…");
    await bubble.click();
    await expect(page.locator("#toast")).toHaveText("This video is still processing. It will play in a moment.");
    await expect(page.locator("[data-chat-media-viewer]")).not.toBeVisible();

    await page.evaluate(() => { window.__renditionReady = true; });
    // The backoff re-reads just that message, then the bubble becomes playable.
    await expect(bubble.locator(".chat-video-play")).toBeVisible({ timeout: 15_000 });
    await expect(bubble.locator(".chat-video-status")).toHaveCount(0);
    await bubble.click();
    const video = page.locator("[data-chat-media-viewer] video");
    await expect(video).toHaveAttribute("src", "https://media.example/renditions/web.mp4");
    const playback = await video.evaluate(async (element) => {
        element.muted = true;
        if (element.readyState < 3) await new Promise((resolve, reject) => {
            element.addEventListener("canplay", resolve, { once: true });
            element.addEventListener("error", () => reject(new Error(`media error ${element.error?.code}`)), { once: true });
        });
        const readyState = element.readyState;
        const before = element.currentTime;
        await element.play();
        await new Promise((resolve) => setTimeout(resolve, 400));
        return { readyState, before, after: element.currentTime, width: element.videoWidth,
            h264: element.canPlayType('video/mp4; codecs="avc1.640028"') };
    });
    expect(playback.h264).not.toBe("");
    expect(playback.readyState).toBeGreaterThanOrEqual(3);
    expect(playback.width).toBeGreaterThan(0);
    expect(playback.after).toBeGreaterThan(playback.before);
});

test("a video with no rendition sends the viewer to the app", async ({ page }) => {
    await seedVideos(page);
    const bubble = page.locator('[data-open-chat-media-message="video-unavailable"]');
    await expect(bubble.locator(".chat-video-status")).toHaveText("Open in the app to watch");
    await bubble.click();
    await expect(page.locator("#toast")).toHaveText("This video can't play on the web. Open it in the Valid app.");
    await expect(page.locator("[data-chat-media-viewer]")).not.toBeVisible();
    // The processing clip beside it is re-read; the unavailable one never is.
    await expect.poll(() => page.evaluate(() => window.__videoReads[99] || 0), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    expect(await page.evaluate(() => window.__videoReads[100] || 0)).toBe(0);
});
