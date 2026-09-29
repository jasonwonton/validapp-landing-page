import { expect, test } from "@playwright/test";

// Sending a message must not rebuild existing bubbles or reload their images.
test("sending keeps loaded chat images in place", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    const image = page.locator(".chat-timeline img[data-media-key]").first();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((node) => node.complete && node.naturalWidth > 0)).toBe(true);
    await image.evaluate((node) => { node.__marker = "original"; window.__mediaLoads = 0; node.addEventListener("load", () => { window.__mediaLoads += 1; }); });
    const rowsBefore = await page.locator(".chat-timeline [data-list-key]").evaluateAll((rows) => rows.map((row) => { row.__row = true; return row.dataset.listKey; }));
    const composer = page.getByRole("textbox", { name: "Message", exact: true });
    for (const text of ["one", "two"]) {
        await composer.fill(text);
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await expect(page.locator(".chat-message.mine").filter({ hasText: text }).last()).toBeVisible();
    }
    expect(await page.locator(".chat-timeline img[data-media-key]").first().evaluate((node) => node.__marker)).toBe("original");
    expect(await page.evaluate(() => window.__mediaLoads)).toBe(0);
    // Earlier rows are reused, not rebuilt, and still carry list positions.
    const reused = await page.locator(".chat-timeline [data-list-key]").evaluateAll((rows, keys) => rows.filter((row) => keys.includes(row.dataset.listKey)).every((row) => row.__row === true), rowsBefore);
    expect(reused).toBe(true);
    const sizes = await page.locator(".chat-timeline [aria-setsize]").evaluateAll((rows) => [...new Set(rows.map((row) => row.getAttribute("aria-setsize")))]);
    expect(sizes).toHaveLength(1);
});
