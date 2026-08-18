import { expect, test } from "@playwright/test";


test.use({ serviceWorkers: "block" });


test("web SMS requests use the Turnstile-only backend contract", async ({ page }) => {
    let requestBody = null;
    await page.route("**/api/v1/auth/phone/request/web", async (route) => {
        requestBody = route.request().postDataJSON();
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                phone_number: "4155550123",
                channel: "sms",
                status: "pending",
                attempt_count: 1,
                check_count: 0,
                last_sent_at: new Date().toISOString(),
            }),
        });
    });
    await page.goto("/app/?demo=1&signin=1");

    await page.evaluate(async () => {
        const { ValidAPI } = await import("/app/api.js");
        const api = new ValidAPI();
        await api.requestPhoneVerification("4155550123", "single-use-turnstile-token");
    });

    expect(requestBody).toEqual({
        phone_number: "4155550123",
        channel: "sms",
        turnstile_token: "single-use-turnstile-token",
    });
});


test("production CSP permits only Cloudflare's Turnstile script and frame host", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");

    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(policy).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(policy).toContain("frame-src https://challenges.cloudflare.com");
    expect(policy).toContain("connect-src 'self' https://api.six7.lol https://validappcdn.com");
});


test("signup exchanges a browser challenge token before sending SMS", async ({ page }) => {
    let otpRequest = null;
    await page.addInitScript(() => {
        window.turnstile = {
            render(selector, options) {
                setTimeout(() => options.callback("verified-browser-token"), 0);
                return "widget-1";
            },
            getResponse() {
                return "";
            },
            reset() {},
            remove() {},
        };
    });
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?*", (route) => (
        route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
    ));
    await page.route("**/api/v1/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/auth/session")) {
            return route.fulfill({ status: 401, contentType: "application/json", body: '{"detail":"signed out"}' });
        }
        if (url.pathname.endsWith("/config")) {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ turnstile_site_key: "public-site-key" }),
            });
        }
        if (url.pathname.endsWith("/highschools/nearby")) {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    schools: [{
                        id: 77,
                        name: "Westview High School",
                        city: "San Diego",
                        state: "CA",
                        min_grade: 9,
                        max_grade: 12,
                    }],
                }),
            });
        }
        if (url.pathname.endsWith("/users/phone-check")) {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ exists: false }),
            });
        }
        if (url.pathname.endsWith("/auth/phone/request/web")) {
            otpRequest = route.request().postDataJSON();
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    phone_number: "4155550123",
                    channel: "sms",
                    status: "pending",
                    attempt_count: 1,
                    check_count: 0,
                    last_sent_at: new Date().toISOString(),
                    can_resend: false,
                }),
            });
        }
        return route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"not mocked"}' });
    });

    await page.goto("/app/?signin=1");
    await page.getByRole("button", { name: "Create an account" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("ZIP code").fill("90210");
    await dialog.getByRole("option", { name: /Westview High School/ }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("radio", { name: /Senior/ }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Phone number").fill("4155550123");
    await dialog.getByRole("button", { name: "Continue" }).click();

    await expect(dialog.locator("#signupCodeHint")).toContainText("(415) 555-0123");
    expect(otpRequest.turnstile_token).toBe("verified-browser-token");
});
