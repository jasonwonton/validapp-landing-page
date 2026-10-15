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

test("chat photo review loads the Featured catalog once and leaves the photo untouched until a filter is swiped", async ({ page }) => {
    const catalogRequests = [];
    page.on('request', request => { if (request.url().includes('camera-filters')) catalogRequests.push(request.url()); });
    await signInToDemo(page);
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.getFeaturedCameraFilters;
        window.catalogLoads = 0;
        DemoAPI.prototype.getFeaturedCameraFilters = function () { window.catalogLoads++; return original.call(this); };
    });
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Open camera" }).click();
    const dialog = page.getByRole("dialog", { name: "Send media" });
    await dialog.locator(".chat-media-file-input").setInputFiles("assets/AppIconV2.png");
    await expect(dialog.locator('.chat-media-publish')).toBeEnabled();
    await expect(dialog.getByRole("group", { name: "Photo effect" })).toHaveCount(0);
    const preview = dialog.getByRole("img", { name: "Photo preview" });
    const original = await canvasDigest(preview);
    await dialog.getByRole('button', { name: 'Add or edit caption', exact: true }).click();
    await dialog.getByRole("textbox", { name: "Caption" }).fill("Keep my caption");
    await dialog.getByRole("textbox", { name: "Caption" }).press("Enter");
    expect(await canvasDigest(preview)).toEqual(original);
    await dialog.locator(".chat-media-file-input").setInputFiles("assets/AppIconV2.png");
    await expect(dialog.locator('.chat-media-publish')).toBeEnabled();
    expect(await page.evaluate(() => window.catalogLoads)).toBe(1);
    expect(catalogRequests).toEqual([]);
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    // Queued: the camera closes at once, with no toast.
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Photo sent", { exact: true })).toHaveCount(0);
});

async function canvasDigest(locator) {
    return locator.evaluate((node) => {
        const pixels = node.getContext("2d").getImageData(0, 0, node.width, node.height).data;
        let digest = 2166136261;
        for (let index = 0; index < pixels.length; index += 4) {
            digest ^= pixels[index] | (pixels[index + 1] << 8) | (pixels[index + 2] << 16);
            digest = Math.imul(digest, 16777619);
        }
        return String(digest >>> 0);
    });
}

test("a single-view Memento remains a safe fallback and preserves the authoritative publish flow", async ({ page }) => {
    // A canvas camera whose front camera is missing: the back photo alone posts.
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
            async getUserMedia(constraints) {
                const facing = constraints?.video?.facingMode?.ideal || "environment";
                if (facing === "user") throw new DOMException("Second camera unavailable", "NotReadableError");
                const canvas = document.createElement("canvas");
                canvas.width = 640; canvas.height = 480;
                const context = canvas.getContext("2d");
                const paint = () => { context.fillStyle = "#6666ff"; context.fillRect(0, 0, 640, 480); };
                paint(); setInterval(paint, 40);
                const stream = canvas.captureStream(25);
                stream.getVideoTracks()[0].getSettings = () => ({ facingMode: facing, width: 640, height: 480 });
                return stream;
            },
            async enumerateDevices() { return []; }, addEventListener() {}, removeEventListener() {},
        } });
    });
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Weekend Crew/ }).click();
    await page.getByRole("button", { name: "Take a Memento" }).click();
    const dialog = page.getByRole("dialog", { name: "Today's Memento" });
    await dialog.getByRole("button", { name: "Take the back photo", exact: true }).click();
    await dialog.getByRole("button", { name: "Use one photo" }).click();
    const preview = dialog.getByRole("img", { name: "Memento preview" });
    await expect(preview).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Swap front and back photos" })).toHaveCount(0);
    await expect(dialog.getByRole("group", { name: "Photo effect" })).toHaveCount(0);
    await expect(dialog.locator('.memento-caption, .memento-options')).toHaveCount(0);
    await expect(dialog.locator('.memento-publish')).toBeEnabled();
    await dialog.getByRole("button", { name: /^Send to / }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".chat-message.mine .memento-label")).toHaveCount(1);
});

test("sequential rear and front photos produce swappable 1080 by 1440 Memento composites", async ({ page }) => {
    await page.goto('/app/');
    await page.evaluate(async () => {
        const { prepareMementoImages } = await import('/app/chat/media.js');
        const first = await (await fetch('/assets/AppIconV2.png')).blob();
        const second = await (await fetch('/assets/app/anonymous.webp')).blob();
        const prepared = await prepareMementoImages(first, second);
        for (const [id, blob] of Object.entries(prepared)) {
            if (!(blob instanceof Blob)) continue;
            const img = document.createElement('img');
            img.id = `prepared-${id}`;
            img.src = URL.createObjectURL(blob);
            document.body.append(img);
        }
    });
    const rearPrimary = await previewDigest(page.locator('#prepared-primary'));
    expect(rearPrimary).toMatchObject({ width: 1080, height: 1440 });
    const frontPrimary = await previewDigest(page.locator('#prepared-swapped'));
    expect(frontPrimary).toMatchObject({ width: 1080, height: 1440 });
    expect(frontPrimary.digest).not.toBe(rearPrimary.digest);

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
