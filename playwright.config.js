import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./tests",
    testIgnore: "**/deployed-origin.spec.js",
    fullyParallel: true,
    forbidOnly: true,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: "list",
    use: {
        baseURL: "http://127.0.0.1:4173",
        trace: "retain-on-failure",
    },
    projects: [
        // Use full Chromium's headless mode: the separate Linux headless shell
        // repeatedly crashed in browser.newContext before loading the app.
        { name: "android", use: { ...devices["Pixel 7"], channel: "chromium" } },
        { name: "desktop", use: { ...devices["Desktop Chrome"] } },
        { name: "desktop-firefox", use: { ...devices["Desktop Firefox"], serviceWorkers: "block" } },
        { name: "desktop-webkit", workers: 1, use: { ...devices["Desktop Safari"], serviceWorkers: "block" } },
    ],
    webServer: {
        command: "python3 -m http.server 4173",
        url: "http://127.0.0.1:4173/app/",
        reuseExistingServer: true,
        stdout: "ignore",
        stderr: "ignore",
    },
});
