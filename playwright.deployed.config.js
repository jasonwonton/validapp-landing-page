import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "");
if (!baseURL || !/^https:\/\//.test(baseURL)) {
    throw new Error("PLAYWRIGHT_BASE_URL must be the reviewed staging HTTPS origin");
}

export default defineConfig({
    testDir: "./tests",
    testMatch: "deployed-origin.spec.js",
    fullyParallel: true,
    forbidOnly: true,
    retries: 0,
    reporter: "list",
    use: {
        baseURL,
        trace: "retain-on-failure",
    },
    projects: [
        { name: "android", use: { ...devices["Pixel 7"] } },
        { name: "desktop", use: { ...devices["Desktop Chrome"] } },
        { name: "desktop-firefox", use: { ...devices["Desktop Firefox"], serviceWorkers: "block" } },
        { name: "desktop-webkit", workers: 1, use: { ...devices["Desktop Safari"], serviceWorkers: "block" } },
    ],
});
