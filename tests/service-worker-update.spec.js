import { expect, test } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createStaticOrigin } from "../scripts/serve-production.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const CURRENT_VERSION = Number((await readFile(path.join(repositoryRoot, 'app/index.html'), 'utf8')).match(/name="valid-app-version" content="web-v(\d+)"/)?.[1]);

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Update fixture did not bind a TCP port");
    return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
    if (!server.listening) return;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("a waiting worker upgrades and rolls back without losing a pending send", async ({ browserName, context, page }) => {
    test.skip(browserName !== "chromium", "Service-worker lifecycle automation is intentionally Chromium-only");

    const fixtureRoot = await mkdtemp(path.join(tmpdir(), "valid-update-soak-"));
    const sourceRoot = path.join(repositoryRoot, "dist");
    await cp(sourceRoot, fixtureRoot, { recursive: true });
    const indexPath = path.join(fixtureRoot, "app/index.html");
    const manifest = JSON.parse(await readFile(path.join(fixtureRoot, "app/build-manifest.json"), "utf8"));
    const appPath = path.join(fixtureRoot, manifest.assets["/app/app.js"]);
    const releaseFor = version => version.toString(16).padStart(20, "0");
    const cacheFor = version => version === 67 ? "valid-web-v67" : `valid-web-v${version}-${releaseFor(version)}`;
    const workerPath = path.join(fixtureRoot, "app/service-worker.js");
    const indexTemplate = await readFile(indexPath, "utf8");
    const appTemplate = await readFile(appPath, "utf8");
    const workerTemplate = await readFile(workerPath, "utf8");
    expect(indexTemplate).toContain(`content="web-v${CURRENT_VERSION}"`);
    expect(workerTemplate).toContain(`v${CURRENT_VERSION}-${manifest.release}`);

    const writeVersion = async (version) => {
        const release = releaseFor(version);
        if (version === 67) {
            const originalIndex = await readFile(path.join(repositoryRoot, "app/index.html"), "utf8");
            const originalWorker = await readFile(path.join(repositoryRoot, "app/service-worker.js"), "utf8");
            await Promise.all([
                writeFile(indexPath, originalIndex.replace(`content="web-v${CURRENT_VERSION}"`, 'content="web-v67"')),
                writeFile(path.join(fixtureRoot, "app/app.js"), `window.__VALID_UPDATE_FIXTURE_VERSION = 67;\n${appTemplate}`),
                writeFile(workerPath, originalWorker.replace(`v${CURRENT_VERSION}\``, 'v67`')),
            ]);
            return;
        }
        const releaseRoot = path.join(fixtureRoot, "app/_static", release);
        await cp(path.join(sourceRoot, "app/_static", manifest.release), releaseRoot, { recursive: true });
        await Promise.all([
            writeFile(indexPath, indexTemplate.replaceAll(manifest.release, release).replace(`content="web-v${CURRENT_VERSION}"`, `content="web-v${version}"`)),
            writeFile(path.join(releaseRoot, "app.js"), `window.__VALID_UPDATE_FIXTURE_VERSION = ${version};\n${appTemplate}`),
            writeFile(workerPath, workerTemplate.replaceAll(manifest.release, release).replace(`v${CURRENT_VERSION}-`, `v${version}-`)),
        ]);
    };

    await writeVersion(67);
    const server = await createStaticOrigin({ root: fixtureRoot });
    const origin = await listen(server);
    const appVersion = page.locator('meta[name="valid-app-version"]');
    const updateButton = page.getByRole("button", { name: "Update", exact: true });

    const cacheNames = () => page.evaluate(() => caches.keys().then((names) => names.sort()));
    const pendingSend = () => page.evaluate(async () => {
        const entry = document.querySelector('script[type="module"][src]').src;
        const outbox = await import(new URL("./chat/outbox.js", entry).href);
        return outbox.listChatTextOutbox("update-user");
    });
    const waitForController = () => page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return Boolean(registration?.active && navigator.serviceWorker.controller);
    });

    const installWaitingVersion = async (fromVersion, toVersion) => {
        await writeVersion(toVersion);
        await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            if (!registration) throw new Error("No service-worker registration is available");
            await registration.update();
        });
        await expect.poll(() => page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            return registration?.waiting?.state || null;
        })).toBe("installed");
        await expect(updateButton).toBeVisible();
        await expect(appVersion).toHaveAttribute("content", `web-v${fromVersion}`);
        await expect.poll(cacheNames).toEqual([cacheFor(fromVersion), cacheFor(toVersion)].sort());

        await updateButton.click();
        await expect(appVersion).toHaveAttribute("content", `web-v${toVersion}`);
        await expect.poll(() => page.evaluate(() => window.__VALID_UPDATE_FIXTURE_VERSION)).toBe(toVersion);
        await waitForController();
        await expect(page.locator("#appView")).toBeVisible();
        await expect(updateButton).toBeHidden();
        await expect.poll(cacheNames).toEqual([cacheFor(toVersion)]);
        await expect.poll(pendingSend).toEqual([expect.objectContaining({
            user_id: "update-user",
            chat_id: "update-chat",
            client_request_id: "update-send",
            body: "keep this pending",
        })]);
    };

    try {
        await page.route(`${origin}/api/v1/auth/session`, (route) => route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                access_token: null,
                user: { id: "update-user", first_name: "Taylor", username: "update_taylor" },
            }),
        }));
        await page.goto(`${origin}/app/?signin=1`);
        await waitForController();
        await expect(appVersion).toHaveAttribute("content", "web-v67");
        await expect.poll(() => page.evaluate(() => window.__VALID_UPDATE_FIXTURE_VERSION)).toBe(67);
        await expect.poll(cacheNames).toEqual([cacheFor(67)]);

        await page.evaluate(async () => {
            const entry = document.querySelector('script[type="module"][src]').src;
        const outbox = await import(new URL("./chat/outbox.js", entry).href);
            await outbox.putChatTextOutbox({
                userId: "update-user",
                chatId: "update-chat",
                clientRequestId: "update-send",
                body: "keep this pending",
            });
        });

        await installWaitingVersion(67, CURRENT_VERSION);

        await context.setOffline(true);
        await page.reload();
        await expect(page).toHaveTitle("Valid");
        await expect(appVersion).toHaveAttribute("content", `web-v${CURRENT_VERSION}`);
        await expect.poll(() => page.evaluate(() => window.__VALID_UPDATE_FIXTURE_VERSION)).toBe(CURRENT_VERSION);
        await expect.poll(pendingSend).toHaveLength(1);
        await context.setOffline(false);

        await installWaitingVersion(CURRENT_VERSION, 67);
        await installWaitingVersion(67, CURRENT_VERSION);
    } finally {
        await context.setOffline(false).catch(() => null);
        await page.close().catch(() => null);
        await close(server);
        await rm(fixtureRoot, { recursive: true, force: true });
    }
});
