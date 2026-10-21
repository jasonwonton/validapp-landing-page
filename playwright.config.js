import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT || "4173";

export default defineConfig({
    testDir: "./tests",
    testIgnore: "**/deployed-origin.spec.js",
    fullyParallel: true,
    forbidOnly: true,
    retries: 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: "list",
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        trace: "retain-on-failure",
    },
    projects: [
        // Use full Chromium's headless mode: the separate Linux headless shell
        // repeatedly crashed in browser.newContext before loading the app.
        { name: "android", use: { ...devices["Pixel 7"], channel: "chromium" } },
        { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chromium" } },
        { name: "desktop-firefox", use: { ...devices["Desktop Firefox"], serviceWorkers: "block" } },
        { name: "desktop-webkit", workers: 1, use: { ...devices["Desktop Safari"], serviceWorkers: "block" } },
    ],
    webServer: {
        command: `python3 -m http.server ${port} --bind 127.0.0.1`,
        url: `http://127.0.0.1:${port}/app/`,
        reuseExistingServer: true,
        stdout: "ignore",
        stderr: "ignore",
    },
});
