import { expect, test } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createStaticOrigin } from "../scripts/serve-production.mjs";

// web-v114 support case: "It told me to update but it won't let me click the
// button." Any open modal <dialog> (every Android bottom sheet, the passkey
// prompt) made the rest of the document inert, so the update card could be
// seen through the dimmed backdrop but not tapped. These tests drive a real
// old -> new service-worker update with the card under a sheet.

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const CURRENT_VERSION = Number((await readFile(path.join(repositoryRoot, "app/index.html"), "utf8")).match(/name="valid-app-version" content="web-v(\d+)"/)?.[1]);
const NEXT_VERSION = CURRENT_VERSION + 1;

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Update fixture did not bind a TCP port");
    return `http://127.0.0.1:${address.port}`;
}

async function updateFixture() {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), "valid-update-prompt-"));
    const sourceRoot = path.join(repositoryRoot, "dist");
    await cp(sourceRoot, fixtureRoot, { recursive: true });
    const indexPath = path.join(fixtureRoot, "app/index.html");
    const workerPath = path.join(fixtureRoot, "app/service-worker.js");
    const manifest = JSON.parse(await readFile(path.join(fixtureRoot, "app/build-manifest.json"), "utf8"));
    const appTemplate = await readFile(path.join(fixtureRoot, manifest.assets["/app/app.js"]), "utf8");
    const indexTemplate = await readFile(indexPath, "utf8");
    const workerTemplate = await readFile(workerPath, "utf8");
    expect(indexTemplate).toContain(`content="web-v${CURRENT_VERSION}"`);
    expect(workerTemplate).toContain(`v${CURRENT_VERSION}-${manifest.release}`);

    const writeVersion = async (version, { ignoreSkipWaiting = false } = {}) => {
        const release = `${version.toString(16).padStart(8, "0")}${"e".repeat(12)}`;
        const releaseRoot = path.join(fixtureRoot, "app/_static", release);
        await cp(path.join(sourceRoot, "app/_static", manifest.release), releaseRoot, { recursive: true });
        let worker = workerTemplate.replaceAll(manifest.release, release).replace(`v${CURRENT_VERSION}-`, `v${version}-`);
        if (ignoreSkipWaiting) worker = worker.replace("self.skipWaiting();", "void 0;");
        await Promise.all([
            writeFile(indexPath, indexTemplate.replaceAll(manifest.release, release).replace(`content="web-v${CURRENT_VERSION}"`, `content="web-v${version}"`)),
            writeFile(path.join(releaseRoot, "app.js"), `window.__VALID_UPDATE_FIXTURE_VERSION = ${version};\n${appTemplate}`),
            writeFile(workerPath, worker),
        ]);
    };

    const server = await createStaticOrigin({ root: fixtureRoot });
    const origin = await listen(server);
    return {
        origin,
        writeVersion,
        async close() {
            if (server.listening) await new Promise((resolve) => server.close(resolve));
            await rm(fixtureRoot, { recursive: true, force: true });
        },
    };
}

async function signIn(page, origin) {
    await page.route(`${origin}/api/v1/auth/session`, (route) => route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ access_token: null, user: { id: "update-user", first_name: "Taylor", username: "update_taylor" } }),
    }));
}

async function waitForController(page) {
    await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return Boolean(registration?.active && navigator.serviceWorker.controller);
    });
}

async function installWaiting(page) {
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state || null)).toBe("installed");
}

// What a finger at the centre of the Update button would actually hit.
function hitTestUpdateButton(page) {
    return page.evaluate(() => {
        const button = document.querySelector("#applyAppUpdate");
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
            hitsButton: hit === button || button.contains(hit),
            hit: hit?.id || hit?.tagName || null,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            onScreen: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth,
        };
    });
}

// Null while a reload is tearing the page down.
const version = (page) => page.evaluate(() => window.__VALID_UPDATE_FIXTURE_VERSION).catch(() => null);

test.describe("app update prompt", () => {
    test.skip(({ browserName }) => browserName !== "chromium", "Service-worker lifecycle automation is intentionally Chromium-only");
    test.setTimeout(90_000);

    test("Update stays tappable over an open sheet and reloads onto the new version", async ({ page }) => {
        const fixture = await updateFixture();
        try {
            await fixture.writeVersion(CURRENT_VERSION);
            await signIn(page, fixture.origin);
            await page.goto(`${fixture.origin}/app/`);
            await waitForController(page);
            await expect.poll(() => version(page)).toBe(CURRENT_VERSION);

            await fixture.writeVersion(NEXT_VERSION);
            await installWaiting(page);
            const updateButton = page.locator("#applyAppUpdate");
            await expect(updateButton).toBeVisible();
            await expect.poll(() => hitTestUpdateButton(page)).toMatchObject({ hitsButton: true, onScreen: true });

            // The passkey prompt opens by itself on launch for accounts without a
            // passkey; any other sheet makes the rest of the page inert the same way.
            await page.evaluate(() => document.querySelector("#passkeyEnrollmentDialog").showModal());
            await expect(page.locator("#passkeyEnrollmentDialog")).toBeVisible();
            const hit = await hitTestUpdateButton(page);
            expect(hit).toMatchObject({ hitsButton: true, onScreen: true });
            expect(hit.width).toBeGreaterThanOrEqual(44);
            expect(hit.height).toBeGreaterThanOrEqual(44);

            await updateButton.click();
            await expect.poll(() => version(page)).toBe(NEXT_VERSION);
            await expect(page.locator('meta[name="valid-app-version"]')).toHaveAttribute("content", `web-v${NEXT_VERSION}`);
            await waitForController(page);
            await expect(updateButton).toBeHidden();
        } finally {
            await fixture.close();
        }
    });

    test("a worker that ignores SKIP_WAITING never leaves the button stuck", async ({ page }) => {
        const fixture = await updateFixture();
        try {
            await fixture.writeVersion(CURRENT_VERSION);
            await signIn(page, fixture.origin);
            await page.goto(`${fixture.origin}/app/`);
            await waitForController(page);

            await fixture.writeVersion(NEXT_VERSION, { ignoreSkipWaiting: true });
            await installWaiting(page);
            const updateButton = page.locator("#applyAppUpdate");
            // Mark this document so the fallback reload is observable.
            await page.evaluate(() => { window.__beforeFallbackReload = true; });
            await updateButton.click();
            await expect(updateButton).toHaveText("Updating…");
            await expect(updateButton).toBeDisabled();
            // ~4 s later the page reloads by itself instead of hanging disabled.
            await expect.poll(() => page.evaluate(() => window.__beforeFallbackReload === true).catch(() => true), { timeout: 20_000 }).toBe(false);
            // The reloaded page retries quietly for a few seconds, then hands
            // the card back, enabled.
            await expect(updateButton).toBeVisible({ timeout: 30_000 });
            await expect(updateButton).toBeEnabled();
            await expect(updateButton).toHaveText("Update");
        } finally {
            await fixture.close();
        }
    });

    test("a cold start with a waiting worker applies it without the prompt", async ({ context, page }) => {
        const fixture = await updateFixture();
        try {
            await fixture.writeVersion(CURRENT_VERSION);
            await signIn(page, fixture.origin);
            await page.goto(`${fixture.origin}/app/`);
            await waitForController(page);

            await fixture.writeVersion(NEXT_VERSION);
            await installWaiting(page);
            // The first window stays open, so the browser keeps the new worker
            // waiting; a fresh launch in a second window must apply it itself.
            const launch = await context.newPage();
            await signIn(launch, fixture.origin);
            await launch.goto(`${fixture.origin}/app/`);
            // Chrome may hold activation while the old window has requests in
            // flight; the launch still converges on the new version.
            await expect.poll(() => version(launch), { timeout: 40_000 }).toBe(NEXT_VERSION);
            await expect(launch.locator("#applyAppUpdate")).toBeHidden();
            await launch.close();
        } finally {
            await fixture.close();
        }
    });
});
