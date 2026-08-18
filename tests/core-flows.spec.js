import { expect, test } from "@playwright/test";

async function signInToDemo(page, query = "") {
    await page.goto(`/app/?demo=1&signin=1${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
}

async function fillSignupThroughUsername(dialog, username = "taylor_j") {
    await expect(dialog.getByLabel("Birthday")).toHaveCount(0);
    await dialog.locator('[data-signup-age="16"]').click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("ZIP code").fill("90210");
    await expect(dialog.locator("[data-signup-school]")).toHaveCount(50);
    await dialog.getByRole("option", { name: /Westview High School/ }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("radio", { name: /Senior/ }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Phone number").fill("4155550123");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("First name").fill("Taylor");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Last name").fill("Jordan");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Username").fill(username);
    await dialog.getByRole("button", { name: "Continue" }).click();
}

test("signed-out experience goes straight to the passkey actions", async ({ page }) => {
    await page.goto("/app/?demo=1");
    await expect(page.getByText("VALID, EVERYWHERE", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Your feed is ready.", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Use the same passkey as the Valid iPhone app/i)).toHaveCount(0);
    const signInButton = page.getByRole("button", { name: /^sign in$/i });
    await expect(signInButton).toBeVisible();
    await expect(signInButton).toHaveText("Sign in with a passkey");
    await expect(signInButton.locator("span")).toHaveCount(0);
    await expect(page.getByText(/fingerprint or face stays on your device/i)).toHaveCount(0);
});

test("authenticated users without a credential are prompted to enroll a passkey", async ({ page }) => {
    await signInToDemo(page, "&passkeys=0");
    const enrollment = page.getByRole("dialog", { name: "Secure your Valid account" });
    await expect(enrollment).toBeVisible();
    await enrollment.getByRole("button", { name: "Create a passkey" }).click();
    await expect(enrollment).toBeHidden();
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.locator("#passkeyStatusText")).toHaveText("1 passkey registered");
});

test("new users can complete passkey-only school onboarding", async ({ page }) => {
    await page.goto("/app/?demo=1");
    await page.getByRole("button", { name: "Create an account" }).click();
    const dialog = page.getByRole("dialog");
    await fillSignupThroughUsername(dialog);
    await dialog.getByRole("radio", { name: "Non-binary" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("heading", { name: "Add a profile photo" })).toBeVisible();
    await expect(dialog.getByText(/receive 2-3x more votes/i)).toBeVisible();
    await expect(dialog.getByText("No password. No phone number.", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("Choose from Library", { exact: true })).toBeVisible();
    await dialog.getByLabel(/Profile photo/).setInputFiles("assets/valid_logo.png");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("#appView")).toBeVisible();
    const contacts = page.locator("#classmatesDialog");
    if (await contacts.isVisible()) await contacts.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("button", { name: "Profile", exact: true })).toBeVisible();
});

test("signup rejects unavailable profile language before creating a passkey", async ({ page }) => {
    await page.goto("/app/?demo=1");
    await page.getByRole("button", { name: "Create an account" }).click();
    const dialog = page.getByRole("dialog");
    await fillSignupThroughUsername(dialog, "f4gg0t_sn1gger");
    await expect(dialog.locator("#signupStatus")).toHaveText("That username is not available. Try another one.");
    await expect(dialog.getByText("Pick a username")).toBeVisible();
});

test("onboarding keeps every action reachable on compact phones", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/app/?demo=1");
    await page.getByRole("button", { name: "Create an account" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator(".signup-step .eyebrow")).toHaveCount(0);
    await expect(dialog.getByText("How old are you?")).toBeInViewport();
    await expect(dialog.getByLabel("Birthday")).toHaveCount(0);
    await expect(dialog.getByRole("listbox", { name: "Age" })).toBeVisible();
    await expect(dialog.locator('[data-signup-age="13"]')).toHaveCSS("font-family", /Jua/);
    await expect(dialog.getByRole("button", { name: "Continue" })).toBeInViewport();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("What school do you go to?")).toBeInViewport();
    await expect(dialog.getByLabel("ZIP code")).toBeInViewport();
    await dialog.getByLabel("ZIP code").fill("90210");
    const schoolResults = dialog.locator("#signupSchoolResults");
    const schoolScroll = await schoolResults.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
    expect(schoolScroll.scrollHeight).toBeGreaterThan(schoolScroll.clientHeight);
    await expect(dialog.locator("#signupSchoolContinue")).toBeInViewport();
    await dialog.getByRole("option", { name: /Westview High School/ }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("What grade are you in?")).toBeInViewport();
    const seniorGrade = dialog.getByRole("radio", { name: /Senior/ });
    await expect(seniorGrade).toHaveCSS("font-family", /Jua/);
    await seniorGrade.click();
    await expect(seniorGrade).toHaveAttribute("aria-checked", "true");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("What's your phone number?")).toBeInViewport();
    await dialog.getByLabel("Phone number").fill("4155550123");
    await expect(dialog.getByLabel("Phone number")).toHaveValue("(415) 555-0123");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("First name").fill("Taylor");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Last name").fill("Jordan");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Username").fill("mobile_taylor");
    await dialog.getByRole("button", { name: "Continue" }).click();
    const genderChoice = dialog.getByRole("radio", { name: "Non-binary" });
    await expect(genderChoice).toHaveCSS("font-family", /Jua/);
    await genderChoice.click();
    await expect(genderChoice).toHaveAttribute("aria-checked", "true");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("Add a profile photo")).toBeInViewport();
    await expect(dialog.getByRole("button", { name: "Continue" })).toBeInViewport();
    await expect(dialog.getByRole("button", { name: "Skip for now" })).toBeInViewport();
});

test("signup ZIP picker lists, filters, and falls back from 50 nearby schools", async ({ page }) => {
    await page.goto("/app/?demo=1");
    await page.getByRole("button", { name: "Create an account" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("ZIP code").fill("90210");
    await expect(dialog.locator("[data-signup-school]")).toHaveCount(50);
    await dialog.getByLabel("Search nearby schools").fill("Central High School 2 Beverly Hills");
    await expect(dialog.locator("[data-signup-school]")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Can't find your school?" }).click();
    await expect(dialog.getByLabel("School name")).toBeVisible();
    await expect(dialog.getByLabel("School name")).toBeEnabled();
    await dialog.getByRole("button", { name: "Back to nearby schools" }).click();
    await expect(dialog.getByLabel("School name")).toBeHidden();
    await expect(dialog.getByLabel("Search nearby schools")).toBeVisible();
});

test("mobile shell stays within interaction performance budgets", async ({ page }) => {
    await page.addInitScript(() => {
        window.__validMetrics = { cls: 0, longTasks: 0 };
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (!entry.hadRecentInput) window.__validMetrics.cls += entry.value;
            }
        }).observe({ type: "layout-shift", buffered: true });
        if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
            new PerformanceObserver((list) => { window.__validMetrics.longTasks += list.getEntries().length; })
                .observe({ type: "longtask", buffered: true });
        }
    });
    await signInToDemo(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.waitForTimeout(300);
    const metrics = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        return {
            domContentLoaded: navigation.domContentLoadedEventEnd,
            load: navigation.loadEventEnd,
            ...window.__validMetrics,
        };
    });
    expect(metrics.domContentLoaded).toBeLessThan(1500);
    expect(metrics.load).toBeLessThan(2500);
    expect(metrics.cls).toBeLessThan(0.1);
    expect(metrics.longTasks).toBeLessThanOrEqual(1);
});

test("reduced-motion users do not receive panel animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInToDemo(page);
    const durationSeconds = await page.locator("#feedPanel").evaluate((element) => {
        const value = getComputedStyle(element).animationDuration;
        return value.endsWith("ms") ? Number.parseFloat(value) / 1000 : Number.parseFloat(value);
    });
    expect(durationSeconds).toBeLessThanOrEqual(0.001);
});

test("strict production CSP permits dynamic progress UI", async ({ page }) => {
    const violations = [];
    page.on("console", (message) => {
        if (message.text().includes("Content Security Policy")) violations.push(message.text());
    });
    await page.goto("/app/?demo=1&locked=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.locator(".feed-gate-progress")).toBeVisible();
    expect(violations).toEqual([]);
});

test("android shell surfaces connectivity and install affordances", async ({ page, context }) => {
    await signInToDemo(page);
    await context.setOffline(true);
    await expect(page.locator("#networkBanner")).toBeVisible();
    await expect(page.locator("#networkBanner")).toContainText("offline");
    await context.setOffline(false);
    await expect(page.locator("#networkBanner")).toBeHidden();

    await page.evaluate(() => {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        event.prompt = () => Promise.resolve();
        event.userChoice = Promise.resolve({ outcome: "accepted" });
        dispatchEvent(event);
    });
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.getByRole("button", { name: "Install Valid" })).toBeVisible();
    await page.getByRole("button", { name: "Install Valid" }).click();
    await expect(page.getByRole("button", { name: "Install Valid" })).toBeHidden();
});

test("Android landing handoff requires native installation before signup", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "userAgent", {
            configurable: true,
            get: () => "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36",
        });
    });
    await page.route("**/api/v1/**", (route) => route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Authentication required" }),
    }));
    await page.goto("/app/?install=1&signup=1");
    const installDialog = page.getByRole("dialog", { name: "Install Valid on Android" });
    await expect(installDialog).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Create your Valid account" })).toBeHidden();

    await page.evaluate(() => {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        event.prompt = () => Promise.resolve();
        event.userChoice = Promise.resolve({ outcome: "accepted" });
        dispatchEvent(event);
    });
    await installDialog.getByRole("button", { name: "Install Valid" }).click();

    await expect(installDialog).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Create your Valid account" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("valid:pwa-installed"))).toBe("1");
});

test("PWA ships install icons and Web Push worker handlers", async ({ request }) => {
    const manifestResponse = await request.get("/app/manifest.webmanifest");
    expect(manifestResponse.ok()).toBeTruthy();
    const manifest = await manifestResponse.json();
    expect(manifest.id).toBe("/app/");
    expect(manifest.icons).toEqual(expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
    ]));
    expect(manifest.orientation).toBe("portrait-primary");
    expect(manifest.shortcuts.map((shortcut) => shortcut.name)).toEqual(["Feed", "Play", "Profile"]);
    expect(manifest.launch_handler.client_mode).toBe("navigate-existing");

    const workerResponse = await request.get("/app/service-worker.js");
    expect(workerResponse.ok()).toBeTruthy();
    const worker = await workerResponse.text();
    expect(worker).toContain('addEventListener("push"');
    expect(worker).toContain('addEventListener("notificationclick"');
    expect(worker).toContain("safeNotificationURL");
    expect(worker).toContain("SKIP_WAITING");
    expect(worker).toContain('{ action: "play", title: "Play" }');
});

test("Android back and forward follow the in-app detail stack", async ({ page }) => {
    await signInToDemo(page);
    const detail = page.locator("#feedDetailDialog");
    await page.locator("[data-feed-detail='9001']").click();
    await expect(detail).toBeVisible();
    await expect(page).toHaveURL(/#screen=feedDetailDialog/);
    await page.goBack();
    await expect(detail).toBeHidden();
    await page.goForward();
    await expect(detail).toBeVisible();
});

test("bottom tabs preserve independent scroll positions", async ({ page }) => {
    await signInToDemo(page);
    await page.evaluate(() => scrollTo(0, 360));
    const feedScroll = await page.evaluate(() => scrollY);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.evaluate(() => scrollTo(0, 720));
    const profileScroll = await page.evaluate(() => scrollY);
    await page.getByRole("button", { name: "Feed", exact: true }).click();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(feedScroll);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(profileScroll);
});

test("the app retains recent profile and feed data for instant relaunch", async ({ page }) => {
    await signInToDemo(page);
    await expect.poll(() => page.evaluate(() => ({
        profile: Boolean(localStorage.getItem("valid:pwa:v1:demo-user:profile")),
        feed: Boolean(localStorage.getItem("valid:pwa:v1:demo-user:feed-personal")),
    }))).toEqual({ profile: true, feed: true });
});

test("pulling from the top exposes the native refresh affordance", async ({ page }) => {
    await signInToDemo(page);
    await page.evaluate(() => {
        const app = document.querySelector("#appView");
        const touch = (type, y = null) => {
            const event = new Event(type, { bubbles: true });
            Object.defineProperty(event, "touches", { value: y === null ? [] : [{ clientY: y }] });
            app.dispatchEvent(event);
        };
        scrollTo(0, 0);
        touch("touchstart", 10);
        touch("touchmove", 140);
    });
    await expect(page.locator("#pullRefreshIndicator")).toHaveClass(/ready/);
    await page.evaluate(() => {
        const event = new Event("touchend", { bubbles: true });
        Object.defineProperty(event, "touches", { value: [] });
        document.querySelector("#appView").dispatchEvent(event);
    });
    await expect(page.locator("#pullRefreshIndicator")).not.toHaveClass(/ready/);
});

test("Android receives the unread count through the app badge API", async ({ page }) => {
    await page.addInitScript(() => {
        window.__validBadgeCalls = [];
        Object.defineProperty(Navigator.prototype, "setAppBadge", {
            configurable: true,
            value(value) { window.__validBadgeCalls.push(value); return Promise.resolve(); },
        });
        Object.defineProperty(Navigator.prototype, "clearAppBadge", {
            configurable: true,
            value() { window.__validBadgeCalls.push(0); return Promise.resolve(); },
        });
    });
    await signInToDemo(page);
    await expect.poll(() => page.evaluate(() => window.__validBadgeCalls.at(-1))).toBeGreaterThan(0);
});

test("Android modals present as draggable bottom sheets", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "android", "Android-only presentation behavior");
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: /Choose a crush/ }).click();
    const dialog = page.locator("#targetedBoostDialog");
    const geometry = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { bottom: rect.bottom, viewport: innerHeight, radius: getComputedStyle(element).borderTopLeftRadius };
    });
    expect(Math.abs(geometry.viewport - geometry.bottom)).toBeLessThan(2);
    expect(geometry.radius).toBe("28px");
});

test("feed navigation, filtering, and reactions work", async ({ page }) => {
    await signInToDemo(page);
    await expect(page.getByText("Who always knows how to make people laugh?")).toBeVisible();
    await page.locator("#loadMoreFeed").evaluate((button) => button.classList.remove("hidden"));
    await expect(page.locator("#loadMoreFeed")).toHaveCSS("margin-top", "24px");
    await expect(page.locator("#loadMoreFeed")).toHaveCSS("margin-bottom", "30px");
    await expect(page.locator("#feedList .feed-section-heading")).toHaveCount(0);
    await page.getByRole("button", { name: "School", exact: true }).click();
    await expect(page.getByText("Who has the best music taste?")).toBeVisible();
    await expect(page.locator("#feedList .feed-section-heading")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Recent", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "My Votes", exact: true })).toBeVisible();
    await page.getByPlaceholder("Search names, questions...").fill("company");
    await expect(page.getByText("Who is most likely to start a company?")).toBeVisible();
    await expect(page.getByText("Who has the best music taste?")).toBeHidden();
    await page.getByPlaceholder("Search names, questions...").fill("");
    const poll = page.locator("[data-feed-detail='9003']");
    await poll.locator("[data-reaction-picker]").click();
    await page.getByRole("dialog", { name: "Choose a reaction" }).getByRole("button", { name: "Love" }).click();
    await expect(poll.locator("[data-reaction-picker]")).toContainText("❤️");
    await page.locator("[data-feed-detail='9003']").click();
    const detail = page.locator("#feedDetailDialog");
    await expect(detail.getByRole("heading", { name: "Who has the best music taste?" })).toBeVisible();
});

test("feed search includes classmates and filters their school activity", async ({ page }) => {
    await signInToDemo(page);
    await page.getByPlaceholder("Search names, questions...").fill("Maya");
    await expect(page.locator("#feedList [data-anonymous-question]")).toHaveCount(0);
    const classmateResult = page.locator("[data-feed-classmate='classmate-1']");
    await expect(classmateResult).toContainText("Maya Chen");
    await classmateResult.click();
    await expect(page.getByRole("button", { name: "School", exact: true })).toHaveClass(/active/);
    await expect(page.getByText("Who has the best music taste?")).toBeVisible();
    await expect(page.getByText("Who is most likely to start a company?")).toBeHidden();
});

test("own school votes do not show a you marker", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "School", exact: true }).click();
    const ownVote = page.locator("[data-feed-detail='9004']");
    await expect(ownVote).toContainText("from Jules Rivera");
    await expect(ownVote).not.toContainText("(you");
    await ownVote.click();
    await expect(page.locator("#feedDetailDialog .detail-screen-header > strong")).toHaveText("Jules Rivera said");
    await expect(page.locator("#feedDetailDialog")).not.toContainText("(you");
});

test("feed polls open the iOS-style detail and moderation flow", async ({ page }) => {
    await signInToDemo(page);
    await page.locator("[data-feed-detail='9001']").click();
    const dialog = page.locator("#feedDetailDialog");
    await expect(dialog).toHaveCSS("position", "fixed");
    await expect(dialog.locator(".detail-screen-header > strong")).toContainText("Sophomore");
    await expect(dialog.locator(".feed-detail-result")).toHaveCount(0);
    await expect(dialog.locator(".feed-detail-art")).toBeVisible();
    await expect(dialog.locator(".feed-detail-option")).toHaveCount(4);
    await expect(dialog.getByText("Jules Rivera").first()).toBeVisible();
    await expect(dialog.locator(".feed-detail-option.selected")).toContainText("Jules Rivera");
    await expect(dialog.locator(".feed-detail-selection-indicator")).toHaveText("👆");
    await expect(dialog.getByRole("button", { name: "Share poll to Snapchat" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Share poll to Instagram" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Share poll to TikTok" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Get God Mode to Reveal who sent this" })).toBeVisible();
    await expect(dialog.getByRole("menuitem", { name: "Delete This Question" })).toBeHidden();
    await expect(dialog.getByRole("menuitem", { name: "Report question" })).toBeHidden();
    await dialog.getByRole("button", { name: "More poll actions" }).click();
    await expect(dialog.getByRole("menuitem", { name: "Delete This Question" })).toBeVisible();
    await expect(dialog.getByRole("menuitem", { name: "Report question" })).toBeVisible();
    page.once("dialog", (confirmation) => confirmation.accept());
    await dialog.getByRole("menuitem", { name: "Report question" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#toast")).toContainText("Question reported");
    await expect(page.locator("[data-feed-detail='9001']")).toHaveCount(0);
});

test("feed polls can be privately deleted without reporting", async ({ page }) => {
    await signInToDemo(page);
    await page.locator("[data-feed-detail='9002']").click();
    const dialog = page.locator("#feedDetailDialog");
    await dialog.getByRole("button", { name: "More poll actions" }).click();
    page.once("dialog", async (confirmation) => {
        expect(confirmation.message()).toContain("It won't be reported or affect anyone else.");
        await confirmation.accept();
    });
    await dialog.getByRole("menuitem", { name: "Delete This Question" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#toast")).toContainText("Question deleted");
    await expect(page.locator("[data-feed-detail='9002']")).toHaveCount(0);
});

test("poll share buttons generate the iOS-style 9:16 photo", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
        Object.defineProperty(navigator, "share", {
            configurable: true,
            value: async ({ files, title, text }) => {
                const bitmap = await createImageBitmap(files[0]);
                const canvas = document.createElement("canvas");
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const context = canvas.getContext("2d");
                context.drawImage(bitmap, 0, 0);
                const artworkBand = context.getImageData(160, 350, 580, 150).data;
                let artworkPixels = 0;
                for (let index = 0; index < artworkBand.length; index += 4) {
                    const difference = Math.abs(artworkBand[index] - 204)
                        + Math.abs(artworkBand[index + 1] - 247)
                        + Math.abs(artworkBand[index + 2] - 244);
                    if (difference > 45) artworkPixels += 1;
                }
                window.__sharedPoll = {
                    width: bitmap.width,
                    height: bitmap.height,
                    name: files[0].name,
                    type: files[0].type,
                    size: files[0].size,
                    title,
                    text,
                    artworkPixels,
                };
                bitmap.close();
            },
        });
    });
    await signInToDemo(page);
    await page.getByRole("button", { name: "School", exact: true }).click();
    await page.locator("[data-feed-detail='9003']").click();
    const dialog = page.locator("#feedDetailDialog");
    await expect(dialog.locator(".feed-detail-art > img")).toHaveAttribute("src", /anonymous\.png/);
    await expect(dialog.locator(".feed-detail-art .artwork-placeholder")).toHaveCount(0);
    await expect(dialog.getByText("Share this poll")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Share poll to Snapchat" }).click();
    await expect(page.locator("#toast")).toContainText("Poll photo shared");
    const sharedPoll = await page.evaluate(() => window.__sharedPoll);
    expect(sharedPoll).toMatchObject({
        width: 900,
        height: 1600,
        type: "image/png",
        title: "Share to Snapchat",
        text: "A poll on Valid · https://validapp.lol",
    });
    expect(sharedPoll.name).toMatch(/^valid-poll-9003\.png$/);
    expect(sharedPoll.size).toBeGreaterThan(10_000);
    expect(sharedPoll.artworkPixels).toBeGreaterThan(5_000);
});

test("poll sharing still creates a photo when CDN artwork cannot be read", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
        Object.defineProperty(navigator, "share", {
            configurable: true,
            value: async ({ files }) => {
                const bitmap = await createImageBitmap(files[0]);
                window.__sharedPollFallback = {
                    width: bitmap.width,
                    height: bitmap.height,
                    size: files[0].size,
                };
                bitmap.close();
            },
        });
    });
    await signInToDemo(page);
    await page.getByRole("button", { name: "School", exact: true }).click();
    await page.locator("[data-feed-detail='9004']").click();
    await page.getByRole("button", { name: "Share poll to Instagram" }).click();
    await expect.poll(
        () => page.evaluate(() => window.__sharedPollFallback || null),
        { timeout: 15_000 },
    ).not.toBeNull();
    const sharedPoll = await page.evaluate(() => window.__sharedPollFallback);
    expect(sharedPoll).toMatchObject({
        width: 900,
        height: 1600,
    });
    expect(sharedPoll.size).toBeGreaterThan(10_000);
});

test("non-subscribers can reach God Mode from a received vote", async ({ page }) => {
    await signInToDemo(page);
    await page.locator("[data-feed-detail='9001']").click();
    await page.getByRole("button", { name: "Get God Mode to Reveal who sent this" }).click();
    const pitch = page.getByRole("dialog", { name: "God Mode" });
    await expect(pitch.getByText("See who likes you with")).toBeVisible();
    await expect(pitch.getByText("2 Reveals / Week")).toBeVisible();
    await expect(pitch.getByRole("button", { name: /Earn God Mode/ })).toBeVisible();
    await expect(pitch.getByRole("button", { name: /Start God Mode/ })).toBeVisible();
    await expect(page.locator("#feedDetailDialog")).toBeVisible();
    await pitch.getByRole("button", { name: /Earn God Mode/ }).click();
    await expect(pitch).toBeHidden();
    const inviteFriends = page.getByRole("dialog", { name: "Invite Friends" });
    await expect(inviteFriends).toBeVisible();
    await inviteFriends.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Get God Mode to Reveal who sent this" }).click();
    await pitch.getByRole("button", { name: "Maybe later" }).click();
    await expect(pitch).toBeHidden();
    await expect(page.locator("#feedDetailDialog")).toBeVisible();
});

test("new users vote to unlock Feed just like iOS", async ({ page }) => {
    await page.goto("/app/?demo=1&locked=1&signin=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("heading", { name: "84 votes" })).toBeVisible();
    await expect(page.getByText("Cast 2 more votes to unlock your Feed and see what classmates said.")).toBeVisible();
    await expect(page.locator(".feed-gate-lock")).toHaveAttribute("src", "../assets/app/lock.png");
    await expect(page.getByText("1 / 3 votes cast")).toBeVisible();
    await page.getByRole("button", { name: "Vote now to unlock Feed" }).click();
    await expect(page.getByText("Who would survive longest on a deserted island?")).toBeVisible();
    await page.locator("[data-choice]").first().click();
    await page.locator("[data-choice]").first().click();
    await page.getByRole("button", { name: "Feed", exact: true }).click();
    await expect(page.getByRole("button", { name: /What is something you are genuinely proud/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "84 votes" })).toHaveCount(0);
});

test("anonymous inbox supports private answers and safety controls", async ({ page }) => {
    await signInToDemo(page);
    await expect(page.locator("#feedList [data-anonymous-answer]")).toHaveCount(1);
    await expect(page.locator("#feedList [data-anonymous-question]")).toHaveCount(2);
    await expect(page.locator("#feedList [data-feed-detail]")).toHaveCount(2);
    await expect(page.getByText("Maya wants a TBH")).toBeVisible();
    await expect(page.getByText("Who always knows how to make people laugh?")).toBeVisible();
    await expect(page.locator("[data-anonymous-question='ask-demo-1']")).toBeVisible();
    await expect(page.locator("[data-anonymous-answer='answer-demo-1']")).toBeVisible();
    await expect(page.locator("[data-anonymous-question='ask-demo-2']")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Anonymous questions" })).toHaveCount(0);
    await page.getByRole("button", { name: /What is something you are genuinely proud/ }).click();
    const answerDialog = page.locator("#anonymousQuestionDialog");
    await expect(answerDialog).toHaveCSS("position", "fixed");
    await expect(answerDialog.getByText("From someone anonymous")).toBeVisible();
    await expect(answerDialog).not.toContainText("Sent anonymously from the web.");
    await expect(answerDialog).not.toContainText("Their identity");
    await answerDialog.getByLabel("Your reply").fill("Helping my friends through a hard semester.");
    await answerDialog.getByRole("button", { name: "Send reply" }).click();
    await expect(answerDialog.getByRole("button", { name: "✓ Reply sent" })).toBeVisible();
    await expect(answerDialog.getByRole("button", { name: "Share answer to Snapchat" })).toBeVisible();
    await expect(answerDialog.getByRole("button", { name: "Share answer to Instagram" })).toBeVisible();
    await expect(answerDialog.getByRole("button", { name: "Share answer to TikTok" })).toBeVisible();
    await expect(page.locator("#auraCount")).toHaveText("1,290");
    await answerDialog.getByRole("button", { name: "Done" }).click();

    await page.getByRole("button", { name: /Maya Chen replied to you/ }).click();
    const replyDialog = page.getByRole("dialog");
    await expect(replyDialog.getByText("What always makes you laugh in class?")).toBeVisible();
    await expect(replyDialog.getByText("Your impressions of our history teacher 😂")).toBeVisible();
    await replyDialog.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: /Who has been making school better lately/ }).click();
    const safetyMenu = page.locator("#anonymousQuestionDialog");
    await expect(safetyMenu.getByRole("menuitem", { name: "Report" })).toBeHidden();
    await safetyMenu.getByRole("button", { name: "More message actions" }).click();
    await expect(safetyMenu.getByRole("menuitem", { name: "Report" })).toBeVisible();
    await expect(safetyMenu.getByRole("menuitem", { name: "Block sender" })).toBeVisible();
    await expect(safetyMenu.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    await page.locator("#anonymousQuestionDialog").getByRole("menuitem", { name: "Report" }).click();
    const reportDialog = page.getByRole("dialog", { name: "Report and block sender" });
    await reportDialog.getByRole("radio", { name: "Harassment or bullying" }).check();
    await reportDialog.getByRole("button", { name: "Report and block sender" }).click();
    await expect(page.locator("#toast")).toContainText("Reported and sender blocked");
    await expect(page.getByRole("button", { name: /Who has been making school better lately/ })).toHaveCount(0);
});

test("play answers a poll and advances", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.locator("body")).toHaveClass(/play-active/);
    await expect(page.locator(".topbar")).toBeHidden();
    await expect(page.locator(".play-streak-chip")).toContainText("7");
    await expect(page.locator(".play-streak-chip")).toContainText("1.5x");
    await expect(page.locator("#auraCount")).toHaveText("1,280");
    const artworkBox = await page.locator("#playCard .question-artwork").boundingBox();
    expect(Math.abs(artworkBox.width - artworkBox.height)).toBeLessThan(16);
    await expect(page.locator("#playCard .choice-button").first()).toHaveCSS("min-height", "90px");
    for (const name of [/Shuffle/, /Nominate/, /Skip \(3\)/]) {
        const button = page.getByRole("button", { name });
        await expect(button).toBeVisible();
    }
    const playCardBox = await page.locator("#playCard .play-card").boundingBox();
    const bottomNavBox = await page.locator("#bottomNav").boundingBox();
    expect(playCardBox.y + playCardBox.height).toBeLessThanOrEqual(bottomNavBox.y + 1);
    await expect(page.getByText("Who would survive longest on a deserted island?")).toBeVisible();
    await page.locator("[data-choice]").first().click();
    await expect(page.getByText("Who should plan the senior trip?")).toBeVisible();
    await expect(page.locator("#auraCount")).toHaveText("1,285");
});

test("play supports shuffle and paid classmate nominations", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: /Shuffle/ })).toBeVisible();
    await page.getByRole("button", { name: /Shuffle/ }).click();
    await page.getByRole("button", { name: /Nominate/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Nominate someone" })).toBeVisible();
    await expect(dialog.getByText("100").first()).toBeVisible();
    const candidate = dialog.locator("[data-nomination]").first();
    const name = await candidate.locator("strong").textContent();
    page.once("dialog", (confirmation) => confirmation.accept());
    await candidate.click();
    await expect(page.locator("#toast")).toContainText(`You nominated ${name}`);
});

test("play matches the iOS per-set skip limit", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: "Skip (3)" })).toBeVisible();
    await page.getByRole("button", { name: "Skip (3)" }).click();
    await page.getByRole("button", { name: "Skip (2)" }).click();
    await page.getByRole("button", { name: "Skip (1)" }).click();
    await expect(page.getByRole("button", { name: "Skip (0)" })).toBeDisabled();
});

test("play exposes safety controls for classmate-submitted polls", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.locator("[data-choice]").first().click();
    await expect(page.getByText("Who should plan the senior trip?")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Report question" })).toBeHidden();
    await expect(page.getByRole("menuitem", { name: "Block submitter" })).toBeHidden();
    await page.getByRole("button", { name: "More question actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Report question" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Block submitter" })).toBeVisible();
    page.once("dialog", (confirmation) => confirmation.accept());
    await page.getByRole("menuitem", { name: "Report question" }).click();
    await expect(page.locator("#toast")).toContainText("Reported to Valid");
    await expect(page.getByText("Who gives the best advice?")).toBeVisible();
});

test("completing a poll set celebrates earned aura before cooldown", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    for (let answered = 0; answered < 4; answered += 1) {
        await page.locator("[data-choice]").first().click();
    }
    await expect(page.getByRole("heading", { name: "Congrats!" })).toBeVisible();
    await expect(page.getByText("You just earned 20 aura")).toBeVisible();
    await expect(page.locator("#auraCount")).toHaveText("1,300");
    await page.getByRole("button", { name: "W aura" }).click();
    await expect(page.getByRole("heading", { name: "Next Poll Set Locked" })).toBeVisible();
    await expect(page.locator("#playLockMessage")).toContainText(/Unlocks in (0:5\d|1:00)/);
});

test("profile information matches the iOS correction and school-change flow", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: "Profile information" }).click();
    const informationDialog = page.getByRole("dialog");
    await expect(informationDialog.getByRole("heading", { name: "Correct profile information" })).toBeVisible();
    await informationDialog.getByRole("button", { name: /School Westview High School/ }).click();
    await expect(informationDialog.getByRole("heading", { name: "School" })).toBeVisible();
    await informationDialog.getByLabel("ZIP code").fill("90210");
    await informationDialog.getByRole("button", { name: "Show schools" }).click();
    await expect(informationDialog.locator("[data-profile-school]")).toHaveCount(50);
    await informationDialog.getByRole("option", { name: /Central High School 2 Beverly Hills/ }).click();
    await expect(informationDialog.locator("#profileSchoolValue")).toHaveText("Central High School 2");
    await informationDialog.getByRole("button", { name: /Name Jules Rivera/ }).click();
    await informationDialog.getByLabel("First name").fill("Julia");
    await informationDialog.getByRole("button", { name: "Done" }).click();
    await informationDialog.getByRole("button", { name: /Username @jules/ }).click();
    await informationDialog.getByLabel("Username").fill("julia_r");
    await informationDialog.getByRole("button", { name: "Done" }).click();
    await informationDialog.getByRole("button", { name: /Grade Junior/ }).click();
    await informationDialog.getByRole("radio", { name: /Senior/ }).click();
    await informationDialog.getByRole("button", { name: "Done" }).click();
    await informationDialog.getByRole("button", { name: "Review 4 changes" }).click();
    await expect(informationDialog.getByRole("heading", { name: "Review changes" })).toBeVisible();
    await expect(informationDialog.getByText("Your classmates, polls, and school feed will switch to the new school immediately.", { exact: false })).toBeVisible();
    await informationDialog.getByRole("button", { name: "Confirm and save" }).click();
    await expect(page.locator("#toast")).toContainText("Profile updated");
    await expect(page.locator("#profileCard")).toContainText("Central High School 2");
});

test("profile exposes iOS-style editing, ask link, purchases, invites, and sign out", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Jules Rivera" })).toBeVisible();
    await expect(page.getByText("Ask Me", { exact: true })).toBeVisible();
    await expect(page.locator("#askLinkCard .ask-link-heading img")).toHaveCount(0);
    await expect(page.getByText("God Mode", { exact: true }).first()).toBeVisible();
    await expect(page.locator("#purchasesSection")).toHaveCSS("border-top-width", "3px");
    await page.getByRole("button", { name: /Start God Mode/ }).click();
    const pitch = page.getByRole("dialog", { name: "God Mode" });
    await expect(pitch.getByRole("button", { name: /Start God Mode/ })).toBeVisible();
    await pitch.getByRole("button", { name: "Maybe later" }).click();
    await expect(page.locator("#purchasesSection .settings-aura-balance")).toHaveCount(0);
    const schoolRanks = page.locator("#schoolCard .school-rank-card");
    await expect(page.locator("#schoolCard")).toContainText("Westview High School");
    await expect(schoolRanks.nth(0)).toContainText("Maya Chen");
    await expect(schoolRanks.nth(0)).toContainText("22 this week");
    await expect(schoolRanks.nth(1)).toContainText("Noah Williams");
    await expect(schoolRanks.nth(2)).toContainText("Jules Rivera (You)");
    await expect(page.getByRole("button", { name: "Change profile picture" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Contacts", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Classmates", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invite Friends" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign Out", exact: true })).toBeVisible();
    await expect(page.locator("#addPasskeyButton")).toBeVisible();
    await expect(page.locator("#addPasskeyButton")).toContainText("Add another passkey");
    await expect(page.locator("#passkeyStatusText")).toHaveText("1 passkey registered");
    await page.getByRole("button", { name: "Profile information" }).click();
    const informationDialog = page.getByRole("dialog");
    await expect(informationDialog.getByRole("heading", { name: "Correct profile information" })).toBeVisible();
    await expect(informationDialog.getByLabel("Bio")).toHaveCount(0);
    await expect(informationDialog.getByRole("button", { name: /School Westview High School/ })).toBeVisible();
    await informationDialog.getByRole("button", { name: "Cancel" }).click();
    await page.locator("[data-edit-bio]").click();
    const bioDialog = page.getByRole("dialog").filter({ hasText: "EDIT BIO" });
    await bioDialog.getByLabel("Bio").fill("Senior year, good music, better people.");
    await bioDialog.getByRole("button", { name: "Save bio" }).click();
    await expect(page.locator("[data-edit-bio]")).toHaveText("Senior year, good music, better people.");
    await page.getByRole("button", { name: /Submit a school question for/i }).click();
    await expect(page.getByRole("dialog", { name: "Submit a school question" })).toBeVisible();
});

test("settings shows aura balance and confirms boost spending", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    const profileAura = page.locator("#profileCard .profile-stat-card").filter({ hasText: "Aura" });
    await expect(profileAura).toContainText("1,280");
    await page.getByRole("button", { name: "Get boosted for 400 aura" }).click();
    const confirmation = page.getByRole("dialog").filter({ hasText: "Get Boosted" });
    await expect(confirmation.getByText("880 aura")).toBeVisible();
    await confirmation.getByRole("button", { name: "Spend 400 aura" }).click();
    await expect(profileAura).toContainText("880");
    await expect(page.getByRole("button", { name: "Global boost active" })).toBeDisabled();
});

test("settings browses and searches classmates with public profile details", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: "Classmates", exact: true }).click();
    const directory = page.getByRole("dialog", { name: "Classmates", exact: true });
    await expect(directory.getByRole("heading", { name: "Classmates (6)" })).toBeVisible();
    await directory.getByPlaceholder("Search classmates...").fill("Maya");
    await expect(directory.getByRole("button", { name: /Maya Chen/ })).toBeVisible();
    await expect(directory.getByRole("button", { name: /Noah Williams/ })).toBeHidden();
    await directory.getByRole("button", { name: /Maya Chen/ }).click();
    const profile = page.getByRole("dialog", { name: "Profile", exact: true });
    await expect(profile.getByRole("heading", { name: "Maya Chen" })).toBeVisible();
    await expect(profile.getByText("Student council and bad puns.")).toBeVisible();
    await expect(profile.getByText("61")).toBeVisible();
    await profile.getByRole("button", { name: "Back to classmates" }).click();
    await expect(directory).toBeVisible();
});

test("God Mode subscribers can reveal a vote sender and consume one weekly reveal", async ({ page }) => {
    await page.goto("/app/?demo=1&godmode=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.locator("[data-feed-detail='9001']").click();
    const detail = page.locator("#feedDetailDialog");
    await expect(detail.getByRole("button", { name: "Reveal who sent this (2 remaining)" })).toBeVisible();
    await detail.getByRole("button", { name: "Reveal who sent this (2 remaining)" }).click();
    const sender = detail.locator(".revealed-sender-row");
    await expect(sender.getByText("Sent by Maya Chen", { exact: true })).toBeVisible();
    await expect(sender).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(sender).toHaveCSS("border-top-width", "0px");
    expect((await sender.boundingBox()).height).toBeLessThanOrEqual(48);
    await expect(page.locator("#toast")).toContainText("Revealed: Maya Chen");
    await detail.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.getByText("God Mode Active")).toBeVisible();
    await expect(page.getByText(/1 weekly reveal left/)).toBeVisible();
});

test("settings removes the Find classmates shortcut", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.getByRole("button", { name: "Find classmates" })).toHaveCount(0);
});

test("settings hides account deletion and policy shortcuts", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.getByRole("button", { name: "Delete account" })).toHaveCount(0);
    await expect(page.getByText("Privacy policy", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Safety & support", { exact: true })).toHaveCount(0);
});
