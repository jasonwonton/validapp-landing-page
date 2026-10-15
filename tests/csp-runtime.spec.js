import { expect, test } from "@playwright/test";
import { captureMemento, syntheticCamera } from "./fixtures/synthetic-camera.js";

test.use({ serviceWorkers: "block" });

async function stubTurnstileScript(page) {
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?*", (route) => (
        route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
    ));
}

test("strict production CSP keeps dynamic app layout functional without inline styles", async ({ page }) => {
    const styleViolations = [];
    const pageErrors = [];
    page.on("console", (message) => {
        if (message.text().includes("Content Security Policy") && message.text().includes("style-src")) {
            styleViolations.push(message.text());
        }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await stubTurnstileScript(page);
    await syntheticCamera(page);
    await page.goto("/app/?demo=1&signin=1");
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        DemoAPI.prototype.putDirectUpload = async (_file, _session, { onProgress } = {}) => {
            onProgress?.(0.5);
            await new Promise(resolve => { window.finishCSPUpload = resolve; });
        };
    });

    await expect.poll(() => page.evaluate(() => (
        getComputedStyle(document.documentElement).getPropertyValue("--visual-viewport-width").trim()
    ))).toMatch(/px$/);
    // The age screen (sign-up) is the signed-out root, with sign-in over it.
    await expect(page.locator("#signupDialog")).toBeVisible();
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Weekend Crew/ }).click();

    // Capture through the Memento camera and send under the same strict CSP:
    // the review closes once the send is queued, and the pending bubble waits
    // on the held upload.
    const capture = await captureMemento(page);
    await capture.getByRole('button', { name: 'Send to Weekend Crew', exact: true }).click();
    await expect(capture).toBeHidden();
    await expect.poll(() => page.evaluate(() => typeof window.finishCSPUpload)).toBe('function');
    await expect(page.locator('.chat-message.mine.sending .memento-label')).toHaveCount(1);
    expect(await page.locator("[style]").count()).toBe(0);
    await page.evaluate(() => window.finishCSPUpload());
    await expect(page.locator('.chat-message.mine.sending')).toHaveCount(0);
    await page.locator('[data-open-memento-gallery]').click();
    await expect(page.getByRole('dialog', { name: 'Mementos', exact: true })).toBeVisible();
    expect(await page.locator("[style]").count()).toBe(0);
    expect(styleViolations).toEqual([]);
    expect(pageErrors).toEqual([]);
});

test("trusted runtime stylesheet releases rules for removed transient elements", async ({ page }) => {
    await stubTurnstileScript(page);
    await page.goto("/app/?demo=1&signin=1");

    const result = await page.evaluate(async () => {
        const { setRuntimeStyles } = await import("/app/runtime-style.js");
        const sheet = [...document.styleSheets].find((candidate) => candidate.href?.endsWith("/app/styles.css"));
        const countRuntimeRules = () => [...sheet.cssRules]
            .filter((rule) => rule.selectorText?.startsWith("[data-valid-runtime-style=")).length;
        const before = countRuntimeRules();
        const nodes = Array.from({ length: 40 }, (_, index) => {
            const node = document.createElement("div");
            document.body.append(node);
            setRuntimeStyles(node, { width: `${index + 1}px` });
            return node;
        });
        const appliedWidth = getComputedStyle(nodes[36]).width;
        nodes.forEach((node) => node.remove());
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { before, after: countRuntimeRules(), appliedWidth };
    });

    expect(result.appliedWidth).toBe("37px");
    expect(result.after).toBe(result.before);
});
