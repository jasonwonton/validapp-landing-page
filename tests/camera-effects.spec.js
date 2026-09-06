import { expect, test } from "@playwright/test";

async function signInToDemo(page, query = "") {
    await page.goto(`/app/?demo=1&signin=1${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
}

async function previewDigest(locator) {
    return locator.evaluate(async (node) => {
        await node.decode();
        const canvas = document.createElement("canvas");
        canvas.width = node.naturalWidth;
        canvas.height = node.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(node, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let digest = 2166136261;
        for (let index = 0; index < pixels.length; index += 4) {
            digest ^= pixels[index] | (pixels[index + 1] << 8) | (pixels[index + 2] << 16);
            digest = Math.imul(digest, 16777619);
        }
        return {
            digest: String(digest >>> 0),
            width: canvas.width,
            height: canvas.height,
        };
    });
}

test("chat photos expose bounded local and Featured Effects and bake the selection into JPEG bytes", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Send media or a sticker" }).click();
    const dialog = page.getByRole("dialog", { name: "Send media" });
    await dialog.locator(".chat-media-file-input").setInputFiles("assets/AppIconV2.png");
    const effects = dialog.getByRole("group", { name: "Photo effect" });
    await expect(effects).toBeVisible();
    await expect(effects.getByRole("button")).toHaveCount(6);
    await expect(effects.getByRole("button", { name: "Sunset photo effect, Featured" })).toBeVisible();
    await expect(effects).toContainText("Face/body-tracked lenses and filtered video remain available in iOS");

    const preview = dialog.getByRole("img", { name: "Photo preview" });
    const original = await previewDigest(preview);
    await dialog.getByRole("textbox", { name: "Text overlay" }).fill("Keep my position");
    const overlay = dialog.locator("[data-media-overlay-position]");
    await overlay.press("Shift+ArrowRight");
    await expect(overlay).toHaveAccessibleName(/60% from left, 50% from top/);
    await effects.getByRole("button", { name: "Vivid photo effect" }).click();
    await expect(dialog.getByText("Photo ready to send")).toBeVisible();
    await expect(effects.getByRole("button", { name: "Vivid photo effect" })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("textbox", { name: "Text overlay" })).toHaveValue("Keep my position");
    await expect(overlay).toHaveAccessibleName(/60% from left, 50% from top/);
    const vivid = await previewDigest(preview);
    expect(vivid.digest).not.toBe(original.digest);
    expect(vivid.width).toBeGreaterThan(0);
    expect(vivid.height).toBeGreaterThan(0);

    await effects.getByRole("button", { name: "Sunset photo effect, Featured" }).click();
    await expect(dialog.getByText("Photo ready to send")).toBeVisible();
    const featured = await previewDigest(preview);
    expect(featured.digest).not.toBe(vivid.digest);
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Photo sent", { exact: true })).toBeVisible();
});

test("Memento photo Effects preserve the authoritative publish flow", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Weekend Crew/ }).click();
    await page.locator(".chat-daily-row > button").click();
    const dialog = page.getByRole("dialog", { name: "Create a Memento" });
    await dialog.locator(".memento-file-input").setInputFiles("assets/AppIconV2.png");
    const preview = dialog.getByRole("img", { name: "Memento preview" });
    const original = await previewDigest(preview);
    const effects = dialog.getByRole("group", { name: "Photo effect" });
    await effects.getByRole("button", { name: "Cool photo effect" }).click();
    await expect(dialog.getByText("Ready to share", { exact: true })).toBeVisible();
    expect((await previewDigest(preview)).digest).not.toBe(original.digest);
    await dialog.getByRole("button", { name: "Share to this chat" }).click();
    await expect(page.getByText(/Memento shared · \+10 Aura/)).toBeVisible();
});

test("Story photo Effects bake locally before the existing durable upload record", async ({ page }) => {
    await signInToDemo(page, "&stories=1");
    await page.getByRole("button", { name: "Add Story" }).click();
    const dialog = page.getByRole("dialog", { name: "Create Story" });
    await dialog.locator(".story-file-input").setInputFiles("assets/AppIconV2.png");
    const preview = dialog.getByRole("img", { name: "Story photo preview" });
    const original = await previewDigest(preview);
    const effects = dialog.getByRole("group", { name: "Photo effect" });
    await effects.getByRole("button", { name: "Warm photo effect" }).click();
    await expect(dialog.getByText("Photo ready to post", { exact: true })).toBeVisible();
    expect((await previewDigest(preview)).digest).not.toBe(original.digest);
    await dialog.getByRole("button", { name: "Post Story" }).click();
    await expect(page.getByText("Story posted", { exact: true })).toBeVisible();
});

test("camera Effect recipes and server catalog growth remain strictly bounded", async ({ page }) => {
    await page.goto("/app/");
    const result = await page.evaluate(async () => {
        const { cameraEffectFilter, createCameraEffectPicker } = await import("/app/camera-effects.js");
        const fieldset = document.createElement("fieldset");
        fieldset.innerHTML = "<div data-camera-effect-options></div>";
        document.body.append(fieldset);
        const filters = Array.from({ length: 40 }, (_, index) => ({
            id: `server-${index}`,
            name: `Server ${index}`,
            recipe: {
                schema_version: 6,
                render_mode: index === 0 ? "generated_code" : "live_recipe",
                saturation: 999,
                contrast: -99,
                brightness: 99,
                wash_opacity: 99,
                vignette_intensity: 99,
                background_style: "gradient",
                background_opacity: 99,
                background_color: "not-a-color",
                background_secondary_color: "#EF5275",
            },
        }));
        const picker = createCameraEffectPicker({ fieldset, api: { getFeaturedCameraFilters: async () => ({ filters }) } });
        picker.setMediaKind("photo");
        await picker.load();
        return {
            optionCount: fieldset.querySelectorAll("button").length,
            filter: cameraEffectFilter({
                saturation: 999,
                contrast: -99,
                brightness: 99,
                grayscale: 99,
                sepia: -99,
                hueRotate: 999,
            }),
        };
    });
    expect(result.optionCount).toBe(20); // Five local + fifteen valid rows from the bounded first sixteen.
    expect(result.filter).toBe("saturate(2) contrast(0.5) brightness(1.35) grayscale(1) sepia(0) hue-rotate(30deg)");
});
