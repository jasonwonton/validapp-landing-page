import { expect, test } from "@playwright/test";

async function signInToDemo(page, suffix = "") {
    await page.goto(`/app/?demo=1&signin=1${suffix}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Chats", exact: true })).toBeVisible();
}

test("sticker preparation creates a bounded transparent PNG without persistent storage", async ({ page }) => {
    await page.goto("/app/");
    const result = await page.evaluate(async () => {
        const source = document.createElement("canvas");
        source.width = 1200;
        source.height = 900;
        const sourceContext = source.getContext("2d");
        sourceContext.fillStyle = "#1f61d1";
        sourceContext.fillRect(0, 0, source.width, source.height);
        sourceContext.fillStyle = "#ff7a45";
        sourceContext.fillRect(300, 180, 600, 540);
        const sourceBlob = await new Promise((resolve) => source.toBlob(resolve, "image/png"));
        const bitmap = await createImageBitmap(sourceBlob);
        try {
            const { centerStickerCut, prepareStickerPNG } = await import("/app/chat/sticker-maker.js");
            const before = { local: localStorage.length, session: sessionStorage.length };
            const sticker = await prepareStickerPNG(bitmap, centerStickerCut());
            const decoded = await createImageBitmap(sticker);
            const sample = document.createElement("canvas");
            sample.width = decoded.width;
            sample.height = decoded.height;
            const context = sample.getContext("2d");
            context.drawImage(decoded, 0, 0);
            const corner = context.getImageData(0, 0, 1, 1).data;
            const center = context.getImageData(Math.floor(decoded.width / 2), Math.floor(decoded.height / 2), 1, 1).data;
            decoded.close();
            return {
                name: sticker.name,
                type: sticker.type,
                size: sticker.size,
                width: sample.width,
                height: sample.height,
                cornerAlpha: corner[3],
                centerAlpha: center[3],
                storageUnchanged: before.local === localStorage.length && before.session === sessionStorage.length,
            };
        } finally {
            bitmap.close();
        }
    });

    expect(result.name).toBe("sticker.png");
    expect(result.type).toBe("image/png");
    expect(result.size).toBeGreaterThan(100);
    expect(result.size).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(960);
    expect(Math.min(result.width, result.height)).toBeGreaterThanOrEqual(16);
    expect(result.cornerAlpha).toBe(0);
    expect(result.centerAlpha).toBe(255);
    expect(result.storageUnchanged).toBe(true);
});

test("sticker maker offers an accessible center cut and sends the saved sticker once", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Send media or a sticker" }).click();

    const media = page.getByRole("dialog", { name: "Send media" });
    const fileChooserPromise = page.waitForEvent("filechooser");
    await media.getByRole("button", { name: "Make a sticker" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles("assets/AppIconV2.png");

    const maker = page.getByRole("dialog", { name: "Make a sticker" });
    await expect(maker).toBeVisible();
    await expect(maker.getByText("A center cut is ready.")).toBeVisible();
    await expect(maker.getByRole("button", { name: "Save and send" })).toBeEnabled();
    await expect(maker.getByRole("button", { name: "Reset to center cut" })).toBeEnabled();
    await maker.getByRole("button", { name: "Save and send" }).click();

    await expect(maker).toBeHidden();
    await expect(page.locator(".chat-message.mine").last().getByRole("img", { name: "Sticker" })).toBeVisible();
    await expect(page.locator(".chat-message.mine").filter({ has: page.getByRole("img", { name: "Sticker" }) })).toHaveCount(1);

    await page.getByRole("button", { name: "Send media or a sticker" }).click();
    await expect(media.getByRole("button", { name: "Send saved sticker" })).toHaveCount(2);
});

test("touch and mouse users can replace the center cut with a bounded lasso", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Send media or a sticker" }).click();
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("dialog", { name: "Send media" }).getByRole("button", { name: "Make a sticker" }).click();
    await (await fileChooserPromise).setFiles("assets/AppIconV2.png");

    const maker = page.getByRole("dialog", { name: "Make a sticker" });
    const canvas = maker.getByRole("img", { name: "Photo with selected sticker cutout" });
    const box = await canvas.boundingBox();
    const positions = [
        [0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75], [0.25, 0.25],
    ];
    await page.mouse.move(box.x + box.width * positions[0][0], box.y + box.height * positions[0][1]);
    await page.mouse.down();
    for (const [x, y] of positions.slice(1)) {
        await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 8 });
    }
    await page.mouse.up();

    await expect(maker.getByText("Loop ready.")).toBeVisible();
    await expect(maker.getByRole("button", { name: "Save and send" })).toBeEnabled();
    await maker.getByRole("button", { name: "Cancel" }).click();
    await expect(maker).toBeHidden();
});

test("an ambiguous sticker save never retries automatically", async ({ page }) => {
    await signInToDemo(page, "&stickerfail=1");
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Send media or a sticker" }).click();
    const media = page.getByRole("dialog", { name: "Send media" });
    const fileChooserPromise = page.waitForEvent("filechooser");
    await media.getByRole("button", { name: "Make a sticker" }).click();
    await (await fileChooserPromise).setFiles("assets/AppIconV2.png");
    const maker = page.getByRole("dialog", { name: "Make a sticker" });
    await maker.getByRole("button", { name: "Save and send" }).click();

    await expect(maker).toBeHidden();
    await expect(media).toBeVisible();
    await expect(media.getByText("Check your stickers before trying again")).toBeVisible();
    await expect(media.getByRole("button", { name: "Send saved sticker" })).toHaveCount(1);
    await page.waitForTimeout(500);
    await expect(media.getByRole("button", { name: "Send saved sticker" })).toHaveCount(1);
});

test("saved sticker deletion is confirmed and leaves existing chat messages intact", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Send media or a sticker" }).click();
    const media = page.getByRole("dialog", { name: "Send media" });
    const fileChooserPromise = page.waitForEvent("filechooser");
    await media.getByRole("button", { name: "Make a sticker" }).click();
    await (await fileChooserPromise).setFiles("assets/AppIconV2.png");
    await page.getByRole("dialog", { name: "Make a sticker" }).getByRole("button", { name: "Save and send" }).click();
    await expect(page.getByRole("dialog", { name: "Make a sticker" })).toBeHidden();

    await page.getByRole("button", { name: "Send media or a sticker" }).click();
    await expect(media.getByRole("button", { name: "Remove saved sticker" })).toHaveCount(2);
    page.once("dialog", (dialog) => dialog.accept());
    await media.getByRole("button", { name: "Remove saved sticker" }).first().click();
    await expect(media.getByRole("button", { name: "Remove saved sticker" })).toHaveCount(1);
    await media.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".chat-message.mine").last().getByRole("img", { name: "Sticker" })).toBeVisible();
});
