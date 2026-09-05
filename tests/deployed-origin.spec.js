import { expect, test } from "@playwright/test";

test("edge serves the hardened app shell and installable PWA assets", async ({ request }) => {
    const app = await request.get("/app/");
    expect(app.status()).toBe(200);
    expect(app.headers()["content-type"]).toContain("text/html");
    expect(app.headers()["cache-control"]).toBe("no-cache");
    expect(app.headers()["x-content-type-options"]).toBe("nosniff");
    expect(app.headers()["x-frame-options"]).toBe("DENY");
    expect(app.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(app.headers()["content-security-policy"]).toContain("style-src 'self'");
    expect(app.headers()["permissions-policy"]).toContain("camera=(self)");
    expect(app.headers()["permissions-policy"]).toContain("microphone=(self)");
    await expect(app.text()).resolves.toContain("<title>Valid</title>");

    const manifest = await request.get("/app/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    expect(manifest.headers()["content-type"]).toContain("application/manifest+json");
    expect(manifest.headers()["cache-control"]).toBe("no-cache");
    const manifestBody = await manifest.json();
    expect(manifestBody).toMatchObject({
        id: "/app/",
        start_url: "./",
        scope: "./",
        display: "standalone",
    });

    const worker = await request.get("/app/service-worker.js");
    expect(worker.status()).toBe(200);
    expect(worker.headers()["content-type"]).toContain("text/javascript");
    expect(worker.headers()["cache-control"]).toBe("no-cache");
    await expect(worker.text()).resolves.toContain('const CACHE_PREFIX = "valid-web-"');
});

test("edge rejects mutation, API fallthrough, missing files, and traversal", async ({ request }) => {
    const mutation = await request.post("/app/", { data: "ignored" });
    expect(mutation.status()).toBe(405);
    expect(mutation.headers().allow).toBe("GET, HEAD");

    const api = await request.get("/api/v1/config");
    expect(api.status()).toBe(404);
    expect(await api.text()).toBe("Not found\n");

    const missing = await request.get("/app/not-found");
    expect(missing.status()).toBe(404);
    expect(missing.headers()["content-type"]).toContain("text/plain");

    const traversal = await request.get("/app/%2e%2e/package.json");
    expect(traversal.status()).toBe(404);
});

test("signed-out shell boots under the deployed response policy", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/app/?signin=1");
    await expect(page).toHaveTitle("Valid");
    await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create an account" })).toBeVisible();
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
    expect(pageErrors).toEqual([]);
});

test("Chromium installs the service worker without persistent private responses", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Service workers are intentionally blocked in this project");
    await page.goto("/app/");
    const result = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        const cacheNames = await caches.keys();
        const cachedURLs = (await Promise.all(cacheNames.map(async (name) => {
            const cache = await caches.open(name);
            return (await cache.keys()).map((request) => request.url);
        }))).flat();
        return { scope: registration.scope, cacheNames, cachedURLs };
    });
    expect(result.scope).toBe(new URL("/app/", test.info().project.use.baseURL).href);
    expect(result.cacheNames).toEqual(["valid-web-v57"]);
    expect(result.cachedURLs.length).toBeGreaterThan(0);
    expect(result.cachedURLs.every((url) => new URL(url).origin === new URL(test.info().project.use.baseURL).origin)).toBe(true);
    expect(result.cachedURLs.some((url) => /\/api\/|validappcdn\.com/i.test(url))).toBe(false);
});
