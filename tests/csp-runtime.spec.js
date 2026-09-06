import { expect, test } from "@playwright/test";

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
    await page.goto("/app/?demo=1&signin=1");

    await expect.poll(() => page.evaluate(() => (
        getComputedStyle(document.documentElement).getPropertyValue("--visual-viewport-width").trim()
    ))).toMatch(/px$/);
    await page.getByRole("button", { name: "Create an account" }).click();
    await expect(page.getByRole("dialog", { name: "Create your Valid account" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Weekend Crew/ }).click();

    const progress = page.locator(".chat-daily-progress i");
    await expect(progress).toBeVisible();
    expect(await progress.evaluate((element) => Number.parseFloat(getComputedStyle(element).width))).toBeGreaterThan(0);
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
