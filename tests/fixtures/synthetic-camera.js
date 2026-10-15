import { expect } from "@playwright/test";

// A canvas camera for Playwright pages, in every engine: getUserMedia returns
// a painted stream that reports the facing it was asked for. `frontFails`
// (or window.frontFails at runtime) makes the front camera unavailable.
export async function syntheticCamera(page, { frontFails = false } = {}) {
    await page.addInitScript(({ frontFails }) => {
        window.cameraStreams = [];
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
            async getUserMedia(constraints) {
                if (!constraints?.video) return new MediaStream();
                const facing = constraints.video.facingMode?.ideal || "environment";
                if (facing === "user" && (frontFails || window.frontFails)) throw new DOMException("Second camera unavailable", "NotReadableError");
                const canvas = document.createElement("canvas");
                canvas.width = 640; canvas.height = 480;
                const context = canvas.getContext("2d");
                const paint = () => { context.fillStyle = facing === "user" ? "#ff6666" : "#6666ff"; context.fillRect(0, 0, 640, 480); };
                paint();
                const timer = setInterval(paint, 40);
                const stream = canvas.captureStream(25);
                const track = stream.getVideoTracks()[0];
                track.getSettings = () => ({ facingMode: facing, width: 640, height: 480 });
                track.getCapabilities = () => ({});
                const stop = track.stop.bind(track);
                track.stop = () => { clearInterval(timer); stop(); };
                window.cameraStreams.push(stream);
                return stream;
            },
            async enumerateDevices() { return []; },
            addEventListener() {}, removeEventListener() {},
        } });
    }, { frontFails });
}

// From an open chat: Take a Memento, back photo, front photo, review ready.
export async function captureMemento(page) {
    await page.getByRole("button", { name: "Take a Memento" }).click();
    const dialog = page.getByRole("dialog", { name: "Today's Memento" });
    await dialog.getByRole("button", { name: "Take the back photo", exact: true }).click();
    await dialog.getByRole("button", { name: "Take the front photo", exact: true }).click();
    await expect(dialog.locator(".memento-publish")).toBeEnabled();
    return dialog;
}
