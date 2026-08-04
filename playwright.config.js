import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./tests",
    fullyParallel: true,
    forbidOnly: true,
    retries: 0,
    reporter: "list",
    use: {
        baseURL: "http://127.0.0.1:4173",
        trace: "retain-on-failure",
        launchOptions: {
            args: process.env.CI ? ["--disable-gpu"] : [],
        },
    },
    projects: [
        { name: "android", use: { ...devices["Pixel 7"] } },
        { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    ],
    webServer: {
        command: "python3 -m http.server 4173",
        url: "http://127.0.0.1:4173/app/",
        reuseExistingServer: true,
        stdout: "ignore",
        stderr: "ignore",
    },
});
