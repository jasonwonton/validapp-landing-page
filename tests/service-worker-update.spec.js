import { expect, test } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createStaticOrigin } from "../scripts/serve-production.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const CURRENT_VERSION = 66;

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
    const appPath = path.join(fixtureRoot, "app/app.js");
    const workerPath = path.join(fixtureRoot, "app/service-worker.js");
    const indexTemplate = await readFile(indexPath, "utf8");
    const appTemplate = await readFile(appPath, "utf8");
    const workerTemplate = await readFile(workerPath, "utf8");
    expect(indexTemplate).toContain(`content="web-v${CURRENT_VERSION}"`);
    expect(workerTemplate).toContain(`\`\${CACHE_PREFIX}v${CURRENT_VERSION}\``);

    const writeVersion = async (version) => {
        await Promise.all([
            writeFile(indexPath, indexTemplate.replace(`content="web-v${CURRENT_VERSION}"`, `content="web-v${version}"`)),
            writeFile(appPath, `window.__VALID_UPDATE_FIXTURE_VERSION = ${version};\n${appTemplate}`),
            writeFile(workerPath, workerTemplate.replace(`\`\${CACHE_PREFIX}v${CURRENT_VERSION}\``, `\`\${CACHE_PREFIX}v${version}\``)),
        ]);
    };

    await writeVersion(65);
    const server = await createStaticOrigin({ root: fixtureRoot });
    const origin = await listen(server);
    const appVersion = page.locator('meta[name="valid-app-version"]');
    const updateButton = page.getByRole("button", { name: "Update", exact: true });

    const cacheNames = () => page.evaluate(() => caches.keys().then((names) => names.sort()));
    const pendingSend = () => page.evaluate(async () => {
        const outbox = await import("/app/chat/outbox.js");
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
        await expect.poll(cacheNames).toEqual([`valid-web-v${fromVersion}`, `valid-web-v${toVersion}`].sort());

        await updateButton.click();
        await expect(appVersion).toHaveAttribute("content", `web-v${toVersion}`);
        await expect.poll(() => page.evaluate(() => window.__VALID_UPDATE_FIXTURE_VERSION)).toBe(toVersion);
        await waitForController();
        await expect(page.locator("#appView")).toBeVisible();
        await expect(updateButton).toBeHidden();
        await expect.poll(cacheNames).toEqual([`valid-web-v${toVersion}`]);
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
        await expect(appVersion).toHaveAttribute("content", "web-v65");
        await expect.poll(() => page.evaluate(() => window.__VALID_UPDATE_FIXTURE_VERSION)).toBe(65);
        await expect.poll(cacheNames).toEqual(["valid-web-v65"]);

        await page.evaluate(async () => {
            const outbox = await import("/app/chat/outbox.js");
            await outbox.putChatTextOutbox({
                userId: "update-user",
                chatId: "update-chat",
                clientRequestId: "update-send",
                body: "keep this pending",
            });
        });

        await installWaitingVersion(65, 66);

        await context.setOffline(true);
        await page.reload();
        await expect(page).toHaveTitle("Valid");
        await expect(appVersion).toHaveAttribute("content", "web-v66");
        await expect.poll(() => page.evaluate(() => window.__VALID_UPDATE_FIXTURE_VERSION)).toBe(66);
        await expect.poll(pendingSend).toHaveLength(1);
        await context.setOffline(false);

        await installWaitingVersion(66, 65);
        await installWaitingVersion(65, 66);
    } finally {
        await context.setOffline(false).catch(() => null);
        await page.close().catch(() => null);
        await close(server);
        await rm(fixtureRoot, { recursive: true, force: true });
    }
});
