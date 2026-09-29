import { expect, test } from "@playwright/test";

// A synthetic camera: left half red, right half blue, a facing marker at the
// top centre. Each track reports the facing it was asked for, and records
// every constraint the app applies (zoom, torch, focus).
async function syntheticCamera(page, { width = 640, height = 480, capabilities = {} } = {}) {
    await page.addInitScript(({ width, height, capabilities }) => {
        window.cameraLog = { requests: [], constraints: [] };
        const make = (facing) => {
            const canvas = document.createElement("canvas");
            canvas.width = width; canvas.height = height;
            const context = canvas.getContext("2d");
            const paint = () => {
                // Bright enough that Auto flash stays off.
                context.fillStyle = "#ff6666"; context.fillRect(0, 0, width / 2, height);
                context.fillStyle = "#6666ff"; context.fillRect(width / 2, 0, width / 2, height);
            };
            paint();
            const timer = setInterval(paint, 40);
            const stream = canvas.captureStream(25);
            const track = stream.getVideoTracks()[0];
            let zoom = capabilities.zoom?.min || 1;
            track.getSettings = () => ({ facingMode: facing, width, height, zoom });
            track.getCapabilities = () => ({ ...capabilities, ...(facing === "user" ? { torch: undefined } : {}) });
            track.applyConstraints = async (constraints) => {
                cameraLog.constraints.push(JSON.parse(JSON.stringify(constraints)));
                if (constraints?.advanced?.[0]?.zoom) zoom = constraints.advanced[0].zoom;
            };
            const stop = track.stop.bind(track);
            track.stop = () => { clearInterval(timer); stop(); };
            return stream;
        };
        // WebKit has no mediaDevices yet when init scripts run; replace it outright.
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
            async getUserMedia(constraints) {
                cameraLog.requests.push(JSON.parse(JSON.stringify(constraints)));
                if (!constraints.video) return new MediaStream();
                return make(constraints.video.facingMode?.ideal || "user");
            },
            async enumerateDevices() { return []; },
            addEventListener() {},
            removeEventListener() {},
        } });
        // ValidPreferences is frozen; record haptic kinds as it is installed.
        window.hapticLog = [];
        let preferences;
        Object.defineProperty(window, "ValidPreferences", {
            configurable: true,
            get: () => preferences,
            set: (value) => { preferences = Object.freeze({ ...value, haptic: (kind) => { hapticLog.push(kind); return value.haptic(kind); } }); },
        });
    }, { width, height, capabilities });
}

async function recordUploads(page) {
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        window.uploadedFiles = [];
        window.uploadOptions = [];
        window.sentPayloads = [];
        // Demo sessions report "already finalized"; make them take the upload so the bytes can be checked.
        const create = DemoAPI.prototype.createChatMediaUpload;
        DemoAPI.prototype.createChatMediaUpload = async function (userId, options) { uploadOptions.push(options); return { ...await create.call(this, userId, options), already_finalized: false }; };
        DemoAPI.prototype.putDirectUpload = async (file) => { uploadedFiles.push(file); };
        const send = DemoAPI.prototype.sendChatMessage;
        DemoAPI.prototype.sendChatMessage = function (userId, chatId, payload) { sentPayloads.push(payload); return send.call(this, userId, chatId, payload); };
    });
}

async function openChatCamera(page, query = "") {
    await page.goto(`/app/?demo=1&signin=1${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await recordUploads(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Send photo or video" }).click();
    return page.locator("[data-chat-media-dialog]");
}

// Colour of the pixel at (fx, fy) of an uploaded file, plus its size.
async function uploadedPixel(page, index, points) {
    return page.evaluate(async ({ index, points }) => {
        const bitmap = await createImageBitmap(uploadedFiles[index]);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        const colors = points.map(([fx, fy]) => [...context.getImageData(Math.floor(fx * bitmap.width), Math.floor(fy * bitmap.height), 1, 1).data].slice(0, 3));
        return { width: bitmap.width, height: bitmap.height, type: uploadedFiles[index].type, size: uploadedFiles[index].size, colors };
    }, { index, points });
}

const isBlue = ([r, g, b]) => b > r + 60 && b > g + 60;
const isRed = ([r, g, b]) => r > g + 60 && r > b + 60;

async function libraryPhoto(page, dialog, { width = 300, height = 400, fill = "rgb(128,128,128)", name = "photo.png" } = {}) {
    await page.evaluate(async ({ width, height, fill, name }) => {
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d");
        if (fill === "gradient") {
            const gradient = context.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, "#3366cc"); gradient.addColorStop(1, "#ffcc66");
            context.fillStyle = gradient;
        } else context.fillStyle = fill;
        context.fillRect(0, 0, width, height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        const input = document.querySelector(".chat-media-file-input");
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], name, { type: "image/png" }));
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }, { width, height, fill, name });
    await expect(dialog.locator(".chat-media-publish")).toBeEnabled();
}

async function swipe(page, locator, dx) {
    const box = await locator.boundingBox();
    const y = box.y + box.height * 0.5;
    const x = box.x + box.width * (dx < 0 ? 0.8 : 0.2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + 4, { steps: 6 });
    await page.mouse.up();
}

test.describe("chat camera capture", () => {
    test.beforeEach(async ({ page }) => {
        const supported = await page.evaluate(() => typeof HTMLCanvasElement.prototype.captureStream === "function").catch(() => true);
        test.skip(!supported, "Synthetic camera needs canvas.captureStream");
        // Synthetic video, canvas grading and JPEG work are CPU-bound.
        test.slow();
    });

    test("front photos are saved mirrored exactly like the preview, rear photos are not", async ({ page }) => {
        await syntheticCamera(page);
        const dialog = await openChatCamera(page);
        const video = dialog.locator(".live-camera-stage video");
        await expect(dialog.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
        await expect(video).toHaveClass(/mirrored/);
        expect(await page.evaluate(() => cameraLog.requests[0].video.facingMode.ideal)).toBe("user");
        // What the person sees: sample the rendered preview itself.
        const shot = await video.screenshot();
        const previewLeft = await page.evaluate(async (base64) => {
            const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
            const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
            return [...context.getImageData(Math.floor(image.width * 0.1), Math.floor(image.height / 2), 1, 1).data].slice(0, 3);
        }, shot.toString("base64"));
        expect(isBlue(previewLeft)).toBe(true);

        await dialog.getByRole("button", { name: "Take photo", exact: true }).click();
        await expect(dialog.getByRole("img", { name: "Photo preview" })).toBeVisible();
        await dialog.locator(".chat-media-publish").click();
        await expect(dialog).toBeHidden();
        const front = await uploadedPixel(page, 0, [[0.2, 0.5], [0.8, 0.5]]);
        expect(isBlue(front.colors[0]) && isRed(front.colors[1])).toBe(true);

        await page.getByRole("button", { name: "Send photo or video" }).click();
        await expect(dialog.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
        await dialog.getByRole("button", { name: "Switch front and rear camera" }).click();
        await expect(video).not.toHaveClass(/mirrored/);
        await expect(dialog.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
        await dialog.getByRole("button", { name: "Take photo", exact: true }).click();
        await dialog.locator(".chat-media-publish").click();
        await expect(dialog).toBeHidden();
        const rear = await page.evaluate(() => uploadedFiles.length);
        const rearPixels = await uploadedPixel(page, rear - 2, [[0.2, 0.5], [0.8, 0.5]]);
        expect(isRed(rearPixels.colors[0]) && isBlue(rearPixels.colors[1])).toBe(true);
    });

    test("captures crop 3:4 at the stream's resolution, never upscale, and encode once with a 640 preview and ThumbHash", async ({ page }) => {
        await page.addInitScript(() => {
            window.encodeLog = []; window.decodeLog = [];
            const toBlob = HTMLCanvasElement.prototype.toBlob;
            HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
                if (type === "image/jpeg") encodeLog.push({ width: this.width, height: this.height, quality });
                return toBlob.call(this, callback, type, quality);
            };
            const decode = window.createImageBitmap;
            window.createImageBitmap = function (source, ...rest) {
                if (source instanceof Blob) decodeLog.push(source.type);
                return decode.call(this, source, ...rest);
            };
        });
        await syntheticCamera(page, { width: 1920, height: 1440 });
        const dialog = await openChatCamera(page);
        await expect(dialog.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
        await dialog.getByRole("button", { name: "Take photo", exact: true }).click();
        await expect(dialog.locator(".chat-media-publish")).toBeEnabled();
        await dialog.locator(".chat-media-publish").click();
        await expect(dialog).toBeHidden();
        const log = await page.evaluate(() => ({ encodes: encodeLog, decodes: decodeLog, options: uploadOptions, payloads: sentPayloads }));
        // The photo and its preview: one JPEG encode each, no JPEG decoded in between.
        expect(log.encodes).toEqual([{ width: 1080, height: 1440, quality: 0.92 }, { width: 480, height: 640, quality: 0.7 }]);
        expect(log.decodes.filter((type) => type === "image/jpeg")).toEqual([]);
        const photo = await uploadedPixel(page, 0, [[0.5, 0.5]]);
        const preview = await uploadedPixel(page, 1, [[0.5, 0.5]]);
        expect([photo.width, photo.height, photo.type]).toEqual([1080, 1440, "image/jpeg"]);
        expect([preview.width, preview.height, preview.type]).toEqual([480, 640, "image/jpeg"]);
        expect(log.options[0]).toMatchObject({ contentType: "image/jpeg", sizeBytes: photo.size, thumbnailSizeBytes: preview.size });
        expect(log.options[0].previewHash).toMatch(/^[A-Za-z0-9+/]{4,64}={0,2}$/);
        expect(log.options[0].previewHash.length).toBeLessThanOrEqual(64);
    });

    test("library photos keep their aspect, cap at the /config long side and follow the byte ladder", async ({ page }) => {
        await page.goto("/app/?demo=1");
        const result = await page.evaluate(async () => {
            const pipeline = await import("/app/camera/photo-pipeline.js");
            const profile = pipeline.chatPhotoProfile({ chat_photo_max_dimension: 2560, chat_photo_jpeg_quality: 0.92, chat_photo_target_bytes: 400_000, chat_photo_preview_max_dimension: 640, chat_photo_preview_jpeg_quality: 0.7 });
            const source = document.createElement("canvas");
            source.width = 4000; source.height = 3000;
            const context = source.getContext("2d");
            const noise = context.createImageData(4000, 3000);
            let seed = 7;
            for (let i = 0; i < noise.data.length; i += 4) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; noise.data[i] = seed & 255; noise.data[i + 1] = (seed >> 8) & 255; noise.data[i + 2] = (seed >> 16) & 255; noise.data[i + 3] = 255; }
            context.putImageData(noise, 0, 0);
            const blob = await new Promise((resolve) => source.toBlob(resolve, "image/png"));
            const decoded = await pipeline.decodePhoto(new File([blob], "big.png", { type: "image/png" }));
            const canvas = pipeline.renderPhoto(decoded.image, { maxDimension: profile.maxDimension });
            decoded.release();
            const encoded = await pipeline.encodeChatPhoto(canvas, profile);
            const small = pipeline.renderPhoto(await createImageBitmap(await new Promise((resolve) => { const c = document.createElement("canvas"); c.width = 200; c.height = 100; c.toBlob(resolve, "image/png"); })), { maxDimension: 2560, aspect: 3 / 4 });
            return { rendered: [canvas.width, canvas.height], encoded: [encoded.width, encoded.height], size: encoded.file.size, quality: encoded.quality, encodes: encoded.encodes, ladder: pipeline.qualityLadder(0.92), small: [small.width, small.height], preview: Boolean(encoded.preview), hash: encoded.previewHash };
        });
        expect(result.rendered).toEqual([2560, 1920]);
        expect(result.ladder).toEqual([0.92, 0.87, 0.82, 0.77, 0.72, 0.7]);
        // Noise misses the budget at full size, so it shrinks (by 0.8) rather than dropping below 0.70.
        expect(result.encoded[0]).toBeLessThan(2560);
        expect(result.encoded[0]).toBeGreaterThanOrEqual(1600);
        expect(result.quality).toBeGreaterThanOrEqual(0.7);
        expect(result.encodes).toBeGreaterThan(1);
        expect(result.small).toEqual([75, 100]);
        expect(result.preview).toBe(true);
        expect(result.hash).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    });

    test("swipe filters wrap around, flash their name, tick a selection haptic and are burned into the photo", async ({ page }) => {
        await syntheticCamera(page);
        const dialog = await openChatCamera(page);
        await libraryPhoto(page, dialog);
        const stage = dialog.locator(".review-stage");
        await swipe(page, stage, -160);
        await expect(dialog.locator(".review-filter-name")).toHaveText("Golden Hour");
        await expect(dialog.locator(".review-filter-name")).toHaveClass(/show/);
        await expect(dialog.locator(".review-filter-status")).toHaveText("Golden Hour filter");
        expect(await page.evaluate(() => hapticLog.includes("selection"))).toBe(true);
        await swipe(page, stage, 160);
        await expect(dialog.locator(".review-filter-name")).toHaveText("Original");
        await swipe(page, stage, 160);
        // The server's Featured look comes after the seven review looks.
        await expect(dialog.locator(".review-filter-name")).toHaveText("Sunset");
        await swipe(page, stage, 160);
        await expect(dialog.locator(".review-filter-name")).toHaveText("Mono");
        await swipe(page, stage, -160);
        await swipe(page, stage, -160);
        await swipe(page, stage, -160);
        await expect(dialog.locator(".review-filter-name")).toHaveText("Golden Hour");
        await dialog.locator(".chat-media-publish").click();
        await expect(dialog).toBeHidden();
        const [pixel] = (await uploadedPixel(page, 0, [[0.5, 0.5]])).colors;
        expect(pixel[0] - pixel[2]).toBeGreaterThan(12);

        await page.getByRole("button", { name: "Send photo or video" }).click();
        await libraryPhoto(page, dialog, { fill: "rgb(40,160,220)" });
        await page.locator(".review-photo").focus();
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("ArrowLeft");
        await expect(dialog.locator(".review-filter-name")).toHaveText("Mono");
        await dialog.locator(".chat-media-publish").click();
        await expect(dialog).toBeHidden();
        const count = await page.evaluate(() => uploadedFiles.length);
        const [mono] = (await uploadedPixel(page, count - 2, [[0.5, 0.5]])).colors;
        expect(Math.max(...mono) - Math.min(...mono)).toBeLessThan(6);
    });

    test("drawing and caption bars: strokes are burned in, captions travel as media_text_overlay", async ({ page }) => {
        await syntheticCamera(page);
        const dialog = await openChatCamera(page);
        await libraryPhoto(page, dialog);
        const stage = dialog.locator(".review-stage");
        const box = await stage.boundingBox();
        await dialog.getByRole("button", { name: "Draw on this" }).click();
        await expect(dialog.getByRole("button", { name: "Done drawing" })).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Add caption" })).toBeHidden();
        for (const name of ["White", "Black", "Red", "Yellow", "Green", "Blue", "Purple", "Thin brush", "Medium brush", "Thick brush"]) await expect(dialog.getByRole("button", { name, exact: true })).toBeVisible();
        await dialog.getByRole("button", { name: "Red", exact: true }).click();
        await dialog.getByRole("button", { name: "Thick brush" }).click();
        await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.3);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.3, { steps: 8 });
        await page.mouse.up();
        await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.8);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.8, { steps: 8 });
        await page.mouse.up();
        await dialog.getByRole("button", { name: "Undo drawing stroke" }).click();
        await dialog.getByRole("button", { name: "Done drawing" }).click();

        // Tap to add a caption at that height; Return commits.
        await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);
        const editor = dialog.getByRole("textbox", { name: "Caption" });
        await expect(editor).toBeFocused();
        await editor.fill("After practice");
        await editor.press("Enter");
        const first = dialog.getByRole("button", { name: /Media text: After practice/ });
        await expect(first).toBeVisible();
        await dialog.getByRole("button", { name: "Add caption" }).click();
        await dialog.getByRole("textbox", { name: "Caption" }).fill("Line one\nsecond");
        await expect(dialog.getByRole("button", { name: /Media text: Line one second/ })).toBeVisible();
        // Drag the first caption up.
        const bar = await first.boundingBox();
        await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
        await page.mouse.down();
        await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2 - box.height * 0.2, { steps: 5 });
        await page.mouse.up();
        // Tap to edit a caption; emptying one deletes it.
        await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.2);
        await dialog.getByRole("textbox", { name: "Caption" }).fill("Delete me");
        await dialog.getByRole("textbox", { name: "Caption" }).press("Enter");
        await dialog.getByRole("button", { name: /Media text: Delete me/ }).click();
        await dialog.getByRole("textbox", { name: "Caption" }).fill("");
        await dialog.getByRole("textbox", { name: "Caption" }).press("Enter");
        await expect(dialog.getByRole("button", { name: /Media text: Delete me/ })).toHaveCount(0);

        await dialog.locator(".chat-media-publish").click();
        await expect(dialog).toBeHidden();
        const overlay = (await page.evaluate(() => sentPayloads.at(-1))).media_text_overlay;
        expect(overlay.overlays).toHaveLength(2);
        expect(overlay).toMatchObject({ text: "After practice", x: 0.5 });
        expect(overlay.overlays[0]).toEqual({ text: overlay.text, x: overlay.x, y: overlay.y });
        expect(overlay.y).toBeGreaterThan(0.45);
        expect(overlay.y).toBeLessThan(0.55);
        expect(overlay.overlays[1]).toEqual({ text: "Line one second", x: 0.5, y: 0.44 });
        const pixels = await uploadedPixel(page, 0, [[0.5, 0.3], [0.5, 0.8], [0.5, overlay.y]]);
        expect(isRed(pixels.colors[0])).toBe(true);
        // The undone stroke and the captions are not in the pixels.
        expect(pixels.colors[1][0]).toBeLessThan(150);
        expect(Math.abs(pixels.colors[2][0] - 128)).toBeLessThan(12);
    });

    test("captions stop at six with a clear message", async ({ page }) => {
        await syntheticCamera(page);
        const dialog = await openChatCamera(page);
        await libraryPhoto(page, dialog);
        for (let index = 0; index < 6; index++) {
            await dialog.getByRole("button", { name: "Add caption" }).click();
            await dialog.getByRole("textbox", { name: "Caption" }).fill(`Caption ${index + 1}`);
            await dialog.getByRole("textbox", { name: "Caption" }).press("Enter");
        }
        await dialog.getByRole("button", { name: "Add caption" }).click();
        await expect(page.getByText("You can add up to 6 captions.")).toBeVisible();
        await expect(dialog.getByRole("textbox", { name: "Caption" })).toHaveCount(0);
        await expect(dialog.locator(".review-caption")).toHaveCount(6);
    });

    test("two-finger pinch zooms the photo, snaps back near 100% and is burned in", async ({ page }) => {
        await syntheticCamera(page);
        const dialog = await openChatCamera(page);
        await page.evaluate(async () => {
            const canvas = document.createElement("canvas"); canvas.width = 300; canvas.height = 400;
            const context = canvas.getContext("2d");
            context.fillStyle = "#ff0000"; context.fillRect(0, 0, 150, 400);
            context.fillStyle = "#0000ff"; context.fillRect(150, 0, 150, 400);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
            const input = document.querySelector(".chat-media-file-input");
            const transfer = new DataTransfer(); transfer.items.add(new File([blob], "halves.png", { type: "image/png" }));
            input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await expect(dialog.locator(".chat-media-publish")).toBeEnabled();
        const stage = dialog.locator(".review-stage");
        const box = await stage.boundingBox();
        const pinch = async (from, to, centerX) => stage.evaluate((node, { from, to, box, centerX }) => {
            node.setPointerCapture = () => {};
            const y = box.y + box.height / 2;
            const fire = (type, id, x) => node.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: id === 1 }));
            fire("pointerdown", 1, centerX - from); fire("pointerdown", 2, centerX + from);
            for (let step = 1; step <= 6; step++) { const d = from + (to - from) * step / 6; fire("pointermove", 1, centerX - d); fire("pointermove", 2, centerX + d); }
            fire("pointerup", 1, centerX - to); fire("pointerup", 2, centerX + to);
        }, { from, to, box, centerX });
        // Zoom 3x about the left quarter: the frame fills with red.
        await pinch(30, 90, box.x + box.width * 0.25);
        await expect(dialog.getByRole("button", { name: "Undo zoom" })).toBeVisible();
        await dialog.locator(".chat-media-publish").click();
        await expect(dialog).toBeHidden();
        const zoomed = await uploadedPixel(page, 0, [[0.1, 0.5], [0.9, 0.5]]);
        expect(isRed(zoomed.colors[0]) && isRed(zoomed.colors[1])).toBe(true);
        expect([zoomed.width, zoomed.height]).toEqual([300, 400]);
    });

    test("camera controls: double-tap flips, tap shows focus, zoom pill and pinch use the zoom constraint, flash cycles and the front flash lights the screen", async ({ page }) => {
        await syntheticCamera(page, { capabilities: { zoom: { min: 1, max: 8, step: 0.1 }, focusMode: ["continuous", "single-shot"], torch: true } });
        const dialog = await openChatCamera(page);
        const stage = dialog.locator(".live-camera-stage");
        await expect(dialog.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
        const box = await stage.boundingBox();
        await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
        await expect(dialog.locator(".live-camera-focus")).toBeVisible();
        await expect.poll(() => page.evaluate(() => cameraLog.constraints.some((c) => c.advanced?.[0]?.focusMode === "single-shot"))).toBe(true);
        const zoom = dialog.getByRole("button", { name: /^Zoom 1×/ });
        await expect(zoom).toBeVisible();
        await zoom.click();
        await expect(dialog.getByRole("button", { name: /^Zoom 2×/ })).toBeVisible();
        await expect.poll(() => page.evaluate(() => cameraLog.constraints.some((c) => c.advanced?.[0]?.zoom === 2))).toBe(true);
        const flash = dialog.locator("[data-camera-flash]");
        await expect(flash).toHaveAccessibleName("Flash: Auto");
        await flash.click();
        await expect(flash).toHaveAccessibleName("Flash: On");
        await dialog.getByRole("button", { name: "Take photo", exact: true }).click();
        await expect(dialog.locator(".live-camera-screen-flash")).toBeVisible();
        await expect(dialog.getByRole("img", { name: "Photo preview" })).toBeVisible();
        await expect(dialog.locator(".live-camera-screen-flash")).toBeHidden();
        await dialog.locator("[data-retake-chat-photo]").click();
        await expect(dialog.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
        const requests = await page.evaluate(() => cameraLog.requests.length);
        await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
        await expect.poll(() => page.evaluate(() => cameraLog.requests.at(-1)?.video?.facingMode?.ideal)).toBe("environment");
        expect(await page.evaluate(() => cameraLog.requests.length)).toBe(requests + 1);
        await expect(dialog.locator(".live-camera-stage video")).not.toHaveClass(/mirrored/);
        // The rear camera uses the torch for its flash.
        await expect(dialog.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
        await expect(flash).toHaveAccessibleName("Flash: On");
        await dialog.getByRole("button", { name: "Take photo", exact: true }).click();
        await expect(dialog.getByRole("img", { name: "Photo preview" })).toBeVisible();
        const torch = await page.evaluate(() => cameraLog.constraints.filter((c) => "torch" in (c.advanced?.[0] || {})).map((c) => c.advanced[0].torch));
        expect(torch.slice(0, 2)).toEqual([true, false]);
    });

    test("the lens frame hook draws into the preview and the captured photo in output space", async ({ page }) => {
        await syntheticCamera(page);
        await page.goto("/app/?demo=1");
        const result = await page.evaluate(async () => {
            const { createLiveCamera, ensureCameraStyles } = await import("/app/live-camera.js");
            await ensureCameraStyles();
            const container = document.createElement("section");
            container.className = "live-camera";
            document.body.append(container);
            const captured = new Promise((resolve) => {
                const camera = createLiveCamera({ container, singlePhoto: true, initialFacing: "user", onCapture: ([bitmap]) => resolve(bitmap), onFallback() {} });
                const targets = new Set();
                camera.setFrameHook((context, width, height, info) => {
                    targets.add(info.target);
                    // Mark the raw video's top-left corner: it must land top-right when mirrored.
                    const [x, y] = info.toOutput(info.crop.x + 1, info.crop.y + 1);
                    context.fillStyle = "#00ff00";
                    context.fillRect(x - 20, y, 20, 20);
                    window.hookTargets = targets;
                });
                camera.open();
                const shutter = container.querySelector("[data-camera-shutter]");
                const wait = () => shutter.disabled || !window.hookTargets?.has("preview") ? setTimeout(wait, 50) : shutter.click();
                wait();
            });
            const bitmap = await captured;
            const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
            const context = canvas.getContext("2d"); context.drawImage(bitmap, 0, 0);
            return { targets: [...window.hookTargets], corner: [...context.getImageData(bitmap.width - 5, 5, 1, 1).data].slice(0, 3), size: [bitmap.width, bitmap.height] };
        });
        expect(result.targets).toEqual(expect.arrayContaining(["preview", "photo"]));
        expect(result.corner).toEqual([0, 255, 0]);
        expect(result.size).toEqual([360, 480]);
    });

    test("HEIC library photos that the browser cannot decode get a clear message", async ({ page }) => {
        await syntheticCamera(page);
        const dialog = await openChatCamera(page);
        await dialog.locator(".chat-media-file-input").setInputFiles({ name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: Buffer.from("not really heic") });
        await expect(dialog.locator(".chat-media-status")).toHaveText("This photo is HEIC; choose a JPEG/PNG or change the camera format.");
        await expect(dialog.locator(".chat-media-publish")).toBeDisabled();
    });
});

// A MediaRecorder stand-in: records "frames" until stopped, then emits one Blob.
async function fakeRecorder(page, supported = ["video/webm;codecs=vp9,opus", "video/webm"]) {
    await page.addInitScript((supported) => {
        window.recorderLog = [];
        window.clockOffset = 0;
        const now = performance.now.bind(performance);
        performance.now = () => now() + window.clockOffset;
        window.MediaRecorder = class extends EventTarget {
            static isTypeSupported(type) { return supported.includes(type); }
            constructor(stream, options) { super(); this.stream = stream; this.options = options; this.state = "inactive"; recorderLog.push({ event: "create", mimeType: options.mimeType, tracks: stream.getTracks().map((t) => t.kind) }); }
            start(slice) { this.state = "recording"; recorderLog.push({ event: "start", slice }); }
            stop() {
                if (this.state === "inactive") return;
                this.state = "inactive";
                recorderLog.push({ event: "stop" });
                const header = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
                setTimeout(() => {
                    const event = new Event("dataavailable"); event.data = new Blob([header, new Uint8Array(4096)], { type: this.options.mimeType }); this.dispatchEvent(event);
                    this.dispatchEvent(new Event("stop"));
                }, 10);
            }
        };
    }, supported);
}

test.describe("chat video recording", () => {
    test.beforeEach(async ({ page }) => {
        const supported = await page.evaluate(() => typeof HTMLCanvasElement.prototype.captureStream === "function").catch(() => true);
        test.skip(!supported, "Recording from the preview needs canvas.captureStream");
        test.slow();
    });

    test("hold records, slide left locks, tap stops; a long clip goes through the ingest and sends one message per segment", async ({ page }) => {
        await syntheticCamera(page);
        await fakeRecorder(page);
        const dialog = await openChatCamera(page, "&ingest=1");
        const shutter = dialog.getByRole("button", { name: "Take photo", exact: true });
        await expect(shutter).toBeEnabled();
        await expect(dialog.locator(".live-camera-hint")).toHaveText("Tap for a photo, hold for video");
        const box = await shutter.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await expect(dialog.locator(".live-camera-timer")).toBeVisible();
        await expect(dialog.locator(".live-camera-timer")).toHaveText(/^\d+\.\d \/ 60$/);
        await expect(dialog.getByRole("button", { name: "Stop recording" })).toBeVisible();
        expect(await page.evaluate(() => recorderLog[0])).toMatchObject({ event: "create", mimeType: "video/webm;codecs=vp9,opus" });
        await page.mouse.move(box.x + box.width / 2 - 90, box.y + box.height / 2, { steps: 6 });
        await expect(dialog.locator("[data-chat-camera]")).toHaveClass(/is-record-locked/);
        expect(await page.evaluate(() => hapticLog.includes("medium"))).toBe(true);
        await page.mouse.up();
        await expect(dialog.getByRole("button", { name: "Stop recording" })).toBeVisible();
        await page.evaluate(() => { window.clockOffset = 20_000; });
        await dialog.getByRole("button", { name: "Stop recording" }).click();
        await expect(dialog.getByLabel("Video preview")).toBeVisible();
        await expect(dialog.locator(".chat-media-send-count")).toHaveText("Sends as 2 videos");
        await expect(dialog.locator(".review-duration")).toHaveText(/^2\d\.\ds$/);
        await dialog.getByRole("button", { name: "Add caption" }).click();
        await dialog.getByRole("textbox", { name: "Caption" }).fill("Long clip");
        await dialog.getByRole("textbox", { name: "Caption" }).press("Enter");
        await dialog.locator(".chat-media-publish").click();
        await expect(page.getByText("2 videos sent", { exact: true })).toBeVisible();
        const result = await page.evaluate(() => ({ payloads: sentPayloads, uploads: uploadOptions, files: uploadedFiles.map((f) => f.type) }));
        expect(result.uploads).toEqual([]);
        expect(result.files).toEqual(["video/webm"]);
        expect(result.payloads).toHaveLength(2);
        expect(result.payloads[0].media_asset_id).toMatch(/segment-1$/);
        expect(result.payloads[1].media_asset_id).toMatch(/segment-2$/);
        expect(result.payloads[0].media_text_overlay).toMatchObject({ text: "Long clip" });
        expect(result.payloads[1].media_text_overlay).toBeUndefined();
        expect(new Set(result.payloads.map((p) => p.client_request_id)).size).toBe(2);
    });

    test("without the ingest a WebM-only browser offers photos only", async ({ page }) => {
        await syntheticCamera(page);
        await fakeRecorder(page);
        const dialog = await openChatCamera(page);
        const shutter = dialog.getByRole("button", { name: "Take photo", exact: true });
        await expect(shutter).toBeEnabled();
        await expect(dialog.locator(".live-camera-hint")).toHaveText("Tap to capture");
        const box = await shutter.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(500);
        await expect(dialog.locator(".live-camera-timer")).toBeHidden();
        await page.mouse.up();
        await expect(dialog.getByRole("img", { name: "Photo preview" })).toBeVisible();
        expect(await page.evaluate(() => recorderLog.length)).toBe(0);
    });

    test("a failed ingest explains itself and does not keep a retry", async ({ page }) => {
        await syntheticCamera(page);
        await fakeRecorder(page);
        const dialog = await openChatCamera(page, "&ingest=fail");
        const shutter = dialog.getByRole("button", { name: "Take photo", exact: true });
        await expect(shutter).toBeEnabled();
        const box = await shutter.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await expect(dialog.getByRole("button", { name: "Stop recording" })).toBeVisible();
        await page.evaluate(() => { window.clockOffset = 3_000; });
        await page.mouse.up();
        await expect(dialog.getByLabel("Video preview")).toBeVisible();
        await expect(dialog.locator(".chat-media-send-count")).toBeHidden();
        await dialog.locator(".chat-media-publish").click();
        await expect(dialog.locator(".chat-media-status")).toContainText("That video could not be read. Try a different clip.");
        await expect(dialog.locator(".chat-media-publish")).toBeEnabled();
        const saved = await page.evaluate(async () => (await (await import("/app/chat/outbox.js")).listChatMediaOutbox("demo-user")).length);
        expect(saved).toBe(0);
    });
});

test("chat media retries resume: finalized uploads are not repeated and sent segments are not sent twice", async ({ page }) => {
    await page.goto("/app/");
    const result = await page.evaluate(async () => {
        const outbox = await import("/app/chat/outbox.js");
        const { deliverChatMedia } = await import("/app/media-delivery.js");
        const calls = [];
        let failFinalize = true, failSecondSend = true;
        const api = {
            async createChatMediaUpload(_user, options) { calls.push(["create", options.clientRequestId, options.previewHash]); return { media_asset_id: "asset-1", upload_url: "/u", thumbnail_upload_url: "/t", upload_method: "PUT", required_headers: {}, thumbnail_required_headers: {}, already_finalized: false }; },
            async putDirectUpload(file, session) { calls.push(["put", file.name, session.upload_url]); },
            async finalizeChatMediaUpload() { calls.push(["finalize"]); if (failFinalize) { failFinalize = false; throw Object.assign(new Error("busy"), { status: 503 }); } },
            async sendChatMessage(_user, _chat, payload) { calls.push(["send", payload.media_asset_id]); return { id: payload.client_request_id }; },
        };
        const photo = { id: "u1:chat-media:photo", user_id: "u1", kind: "chat_media", chat_id: "c1", file: new File(["jpeg"], "chat-photo.jpg", { type: "image/jpeg" }), thumbnail: new File(["p"], "chat-photo-preview.jpg", { type: "image/jpeg" }), preview_hash: "1QcSHQRnh493V4dIh4eXh1h4kJUI", content_type: "image/jpeg", view_once: false, overlay: null, upload_request_id: "req-1", send_request_id: "send-1" };
        await outbox.putChatMediaOutbox(photo);
        try { await deliverChatMedia(api, "u1", photo); } catch (_) { /* first finalize fails */ }
        const [saved] = await outbox.listChatMediaOutbox("u1");
        await deliverChatMedia(api, "u1", saved);
        const photoCalls = calls.splice(0);

        const ingestApi = {
            async request(path, options = {}) {
                calls.push(["request", options.method || "GET", path.replace(/^\/users\/u1/, "")]);
                if (path.endsWith("/media-ingests")) return { ingest_id: "i1", state: "upload_pending", upload_url: "/r2", upload_method: "PUT", required_headers: { "Content-Type": "video/webm" } };
                if (path.endsWith("/finalize")) return { ingest_id: "i1", state: "processing", poll_after_ms: 500, segments: [] };
                return { ingest_id: "i1", state: "ready", segments: [{ media_asset_id: "s1" }, { media_asset_id: "s2" }, { media_asset_id: "s3" }] };
            },
            async putDirectUpload(file, session) { calls.push(["put", session.upload_url, session.required_headers["Content-Type"]]); },
            async sendChatMessage(_user, _chat, payload) {
                calls.push(["send", payload.media_asset_id, payload.client_request_id, Boolean(payload.media_text_overlay)]);
                if (payload.media_asset_id === "s2" && failSecondSend) { failSecondSend = false; throw Object.assign(new Error("offline"), { status: 0 }); }
                return { id: payload.client_request_id };
            },
        };
        const video = { id: "u1:chat-media:video", user_id: "u1", kind: "chat_media", chat_id: "c1", file: new File(["webm"], "recording.webm", { type: "video/webm" }), thumbnail: null, content_type: "video/webm", ingest: true, duration_ms: 40_000, view_once: false, overlay: { text: "hi", x: 0.5, y: 0.44 }, upload_request_id: "req-v", send_request_id: "send-v" };
        await outbox.putChatMediaOutbox(video);
        try { await deliverChatMedia(ingestApi, "u1", video); } catch (_) { /* second segment fails */ }
        const savedVideo = (await outbox.listChatMediaOutbox("u1")).find((record) => record.id === video.id);
        const progress = { sent: savedVideo.sent_segments, ids: [...savedVideo.segment_request_ids], ingest: savedVideo.ingest_id, finalized: savedVideo.ingest_finalized };
        const sent = await deliverChatMedia(ingestApi, "u1", savedVideo);
        await outbox.clearChatMediaOutbox("u1");
        return { photoCalls, videoCalls: calls, savedVideo: progress, sent: sent.map((m) => m.id) };
    });
    expect(result.photoCalls).toEqual([
        ["create", "req-1", "1QcSHQRnh493V4dIh4eXh1h4kJUI"], ["put", "chat-photo.jpg", "/u"], ["put", "chat-photo-preview.jpg", "/t"], ["finalize"],
        // The retry skips both PUTs and only finalizes and sends.
        ["create", "req-1", "1QcSHQRnh493V4dIh4eXh1h4kJUI"], ["finalize"], ["send", "asset-1"],
    ]);
    expect(result.savedVideo.sent).toBe(1);
    expect(result.savedVideo.ids[0]).toBe("send-v");
    const sends = result.videoCalls.filter((call) => call[0] === "send");
    expect(sends.map((call) => call[1])).toEqual(["s1", "s2", "s2", "s3"]);
    expect(sends[0][3]).toBe(true);
    expect(sends.slice(1).every((call) => call[3] === false)).toBe(true);
    expect(new Set(sends.map((call) => call[2])).size).toBe(3);
    expect(result.videoCalls.filter((call) => call[0] === "put")).toEqual([["put", "/r2", "video/webm"]]);
    expect(result.sent).toHaveLength(2);
});

test("Mementos upload directly and fall back per part to the same-origin relay", async ({ page }) => {
    const requests = [];
    const mediaId = "33333333-3333-3333-3333-333333333333";
    await page.route("**/direct-r2/**", (route) => { requests.push({ method: route.request().method(), path: new URL(route.request().url()).pathname }); return route.fulfill({ status: new URL(route.request().url()).pathname.endsWith("primary") ? 403 : 200, body: "" }); });
    await page.route("**/api/v1/**", async (route) => {
        const request = route.request(), url = new URL(request.url());
        requests.push({ method: request.method(), path: url.pathname + url.search, auth: request.headers().authorization || null });
        if (request.method() === "PUT") return route.fulfill({ status: 204 });
        const body = url.pathname.endsWith("/daily-highlight-uploads")
            ? { media_asset_id: mediaId, upload_url: "/direct-r2/primary", secondary_upload_url: "/direct-r2/secondary", proxy_upload_url: `/api/v1/users/u1/daily-highlight-uploads/${mediaId}/content`, proxy_secondary_upload_url: `/api/v1/users/u1/daily-highlight-uploads/${mediaId}/content?variant=secondary`, upload_method: "PUT", required_headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=900" }, already_finalized: false }
            : url.pathname.endsWith("/finalize") ? { media_asset_id: mediaId, state: "ready" } : { entry_id: "entry" };
        await route.fulfill({ json: body });
    });
    await page.goto("/app/");
    await page.evaluate(async () => {
        const { ValidAPI } = await import("/app/api.js");
        const { deliverMementoRecord } = await import("/app/chat/index.js");
        const api = new ValidAPI();
        api.saveSession({ access_token: "memento-token", user: { id: "u1" } });
        await deliverMementoRecord(api, "u1", { file: new File(["primary"], "memento.jpg", { type: "image/jpeg" }), secondary: new File(["secondary"], "memento-swapped.jpg", { type: "image/jpeg" }), request_id: "66666666-6666-6666-6666-666666666666", chat_ids: ["c1"], caption: null });
    });
    expect(requests.filter(({ method }) => method !== "GET").map(({ method, path }) => `${method} ${path}`)).toEqual([
        "POST /api/v1/users/u1/daily-highlight-uploads",
        "PUT /direct-r2/primary",
        `PUT /api/v1/users/u1/daily-highlight-uploads/${mediaId}/content`,
        "PUT /direct-r2/secondary",
        `POST /api/v1/users/u1/daily-highlight-uploads/${mediaId}/finalize`,
        "POST /api/v1/users/u1/daily-entries",
    ]);
    expect(requests.find((request) => request.path.endsWith("/content")).auth).toBe("Bearer memento-token");
});

test("uploads can be cancelled and their timeout grows with the file", async ({ page }) => {
    await page.goto("/app/");
    const result = await page.evaluate(async () => {
        const { ValidAPI } = await import("/app/api.js");
        const timeouts = [];
        window.XMLHttpRequest = class {
            listeners = {}; upload = { addEventListener() {} };
            open() {} setRequestHeader() {}
            addEventListener(name, handler) { this.listeners[name] = handler; }
            send(body) { timeouts.push(this.timeout); this.body = body; }
            abort() { this.listeners.abort(); }
        };
        const api = new ValidAPI();
        const controller = new AbortController();
        const pending = api.putDirectUpload(new Blob([new Uint8Array(50 * 1024 * 1024)]), { upload_url: "/upload" }, { signal: controller.signal });
        controller.abort();
        let error;
        try { await pending; } catch (caught) { error = caught; }
        return { timeouts, cancelled: error.cancelled, message: error.message };
    });
    expect(result.timeouts[0]).toBe(60_000 + 524 * 1000);
    expect(result).toMatchObject({ cancelled: true, message: "The media upload was cancelled." });
});
