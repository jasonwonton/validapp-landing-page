import { expect, test } from "@playwright/test";

// iOS parity for flows 1, 2 and 10: the age screen as the signed-out root,
// the iOS sign-up order and copy, phone sign-in, the screens after sign-up,
// and where push taps land.

async function openRoot(page, query = "") {
    await page.goto(`/app/?demo=1&signup=1${query}`);
    const dialog = page.locator("#signupDialog");
    await expect(dialog.getByRole("button", { name: "Get Started!" })).toBeVisible();
    return dialog;
}

async function pickSchoolBySearch(dialog) {
    await expect(dialog.getByRole("heading", { name: "Pick your school" })).toBeVisible();
    await dialog.getByPlaceholder("School, city, or ZIP").fill("90210");
    await expect(dialog.locator("[data-signup-school]")).toHaveCount(50);
    await dialog.getByRole("option", { name: /Westview High School/ }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
}

test("the age screen is the signed-out root and sign-in is a sheet over it", async ({ page }) => {
    const dialog = await openRoot(page);
    await expect(dialog.getByRole("heading", { name: "How old are you?" })).toHaveCount(0);
    await expect(dialog.getByText("By entering your age, you agree to our")).toBeVisible();
    await expect(dialog.locator("[data-signup-age]")).toHaveCount(23);
    await expect(dialog.locator('[data-signup-age="35"]')).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Get Started!" })).toBeVisible();
    await expect(page.getByText("Welcome Back")).toBeHidden();

    await page.goto("/app/?demo=1&signin=1");
    const sheet = page.getByRole("dialog", { name: "Welcome Back" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: /^sign in$/i })).toHaveText(/Sign in with (Face ID|a passkey)/);
    await expect(sheet.getByRole("button", { name: "Sign in with phone number" })).toBeVisible();
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator("#signupDialog").getByRole("button", { name: "Get Started!" })).toBeVisible();
});

test("Log in on the age screen starts the passkey prompt in the same tap", async ({ page }) => {
    const dialog = await openRoot(page);
    await dialog.getByRole("button", { name: /Already have an account\? Log in/ }).click();
    // The demo passkey succeeds at once and lands in the app.
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
    await expect(page.locator("#signupDialog")).toBeHidden();
});

test("new users go through the iOS sign-up order and land on Play", async ({ page }) => {
    const dialog = await openRoot(page);
    await dialog.locator('[data-signup-age="16"]').click();
    await dialog.getByRole("button", { name: "Get Started!" }).click();

    await expect(dialog.getByRole("heading", { name: "Pick a Couple Friends" })).toBeVisible();
    await expect(dialog.locator("#signupContactsChoose").getByText("Choose a couple friends to find people you know. You can add more anytime.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Skip for now" })).toBeHidden();
    await dialog.getByRole("button", { name: "Choose Friends" }).click();
    await expect(dialog.getByText("Friends Selected!")).toBeVisible();
    await dialog.getByRole("button", { name: "Continue" }).click();

    await pickSchoolBySearch(dialog);
    await expect(dialog.getByRole("heading", { name: "What grade are you in?" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Back" })).toBeVisible();
    await dialog.getByRole("radio", { name: /Senior/ }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();

    await expect(dialog.getByText("This will be used to identify your account")).toBeVisible();
    await expect(dialog.getByText(/Opt in to SMS messages from Valid/)).toBeVisible();
    await dialog.getByLabel("Phone number").fill("4155550123");
    await dialog.getByRole("button", { name: "Continue" }).click();

    await expect(dialog.locator('[data-signup-step="6"] .signup-name-warning')).toHaveText("Fake names ruin the experience for everyone. \u{1F622} Accounts will be deleted.");
    await expect(dialog.locator("#signupVoteBanner")).toHaveText("You've been voted for 3 times already! \u{1F389}");
    await dialog.getByLabel("First name").fill("Taylor");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("heading", { name: "What's your last name?" })).toBeVisible();
    await dialog.getByLabel("Last name").fill("Jordan");
    await dialog.getByRole("button", { name: "Continue" }).click();

    await expect(dialog.getByRole("heading", { name: "Choose a username" })).toBeVisible();
    await expect(dialog.getByText("Pick something unique that your friends will recognize")).toBeVisible();
    await expect(dialog.getByLabel("Username")).toHaveValue("taylorjordan");
    await dialog.getByLabel("Username").fill("taken");
    await expect(dialog.getByText("Username 'taken' is already taken")).toBeVisible();
    await expect(dialog.getByText("@taken1")).toBeVisible();
    await dialog.getByRole("button", { name: "Use" }).click();

    await expect(dialog.getByRole("heading", { name: "What's your gender?" })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Boy" }).locator(".signup-gender-emoji")).toHaveText("\u{1F466}");
    await dialog.getByRole("radio", { name: "Non-binary" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();

    await expect(dialog.getByText(/Profiles with a photo get 2–3x more votes\./)).toBeVisible();
    await dialog.getByRole("button", { name: "Skip for now" }).click();

    await expect(dialog.getByRole("heading", { name: "Keep your account" })).toBeVisible();
    await expect(dialog.getByText("Create a passkey so you can always sign back in—even if you delete the app or change phones.")).toBeVisible();
    await expect(dialog.getByText("Your face stays private")).toBeVisible();
    await dialog.getByRole("button", { name: "Create passkey" }).click();
    await expect(dialog.getByRole("heading", { name: "Your account is secured" })).toBeVisible();
    // Moves on by itself after 1.5 s.
    await expect(dialog.getByRole("heading", { name: "Welcome to Valid!" })).toBeVisible();
    await expect(dialog.getByText("You're all set! Let's start playing.")).toBeVisible();
    await dialog.getByRole("button", { name: "Let's Go!" }).click();

    const friends = page.getByRole("dialog", { name: /Friends & Classmates|Classmates/ });
    await expect(friends).toBeVisible();
    await expect(friends.getByText(/Classmates on Valid/)).toBeVisible();
    await friends.getByRole("button", { name: "Continue" }).click();
    await expect(friends.getByRole("heading", { name: "Invite Friends" })).toBeVisible();
    await expect(friends.getByText("Riley Demo")).toBeVisible();
    await friends.getByRole("button", { name: "Done" }).click();
    await expect(friends).toBeHidden();
    await expect(page.locator("#playPanel")).toBeVisible();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toHaveAttribute("aria-current", "page");
});

// ContactsPermissionView moves on once the picker is used, however many
// contacts the filters keep (a sign-up on Chrome for Android looped here).
for (const [label, picked, error] of [
    ["only filtered contacts (family names, non-US numbers)", [{ name: ["Mom"], tel: ["4155550111"] }, { name: ["Bestie"], tel: ["+44 7700 900123"] }, { name: [], tel: ["4155550113"] }], null],
    ["nothing (the picker closed empty)", [], null],
    ["a cancelled picker", null, "AbortError"],
]) {
    test(`the friends step moves on after picking ${label}`, async ({ page }) => {
        await page.addInitScript(({ picked, error }) => {
            if (picked) window.__demoPickedContacts = picked;
            if (error) window.__demoContactPickerError = error;
        }, { picked, error });
        const dialog = await openRoot(page);
        await dialog.locator('[data-signup-age="16"]').click();
        await dialog.getByRole("button", { name: "Get Started!" }).click();
        if (process.env.SIGNUP_SHOTS === "1" && test.info().project.name === "android" && label.startsWith("only")) {
            await page.screenshot({ path: `${process.env.HOME}/Desktop/validapp-flows/shots/signup-friends/01-choose-friends.png` });
        }
        await dialog.getByRole("button", { name: "Choose Friends" }).click();
        await expect(dialog.getByText("Friends Selected!")).toBeVisible();
        await expect(dialog.locator("#signupStatus")).toHaveText("");
        if (process.env.SIGNUP_SHOTS === "1" && test.info().project.name === "android") {
            await page.screenshot({ path: `${process.env.HOME}/Desktop/validapp-flows/shots/signup-friends/${label.startsWith("only") ? "02-filtered" : label.startsWith("nothing") ? "03-empty" : "04-cancelled"}.png` });
        }
        await dialog.getByRole("button", { name: "Continue" }).click();
        await expect(dialog.getByRole("heading", { name: "Pick your school" })).toBeVisible();
    });
}

test("a contact picker that fails to open falls back to the invite card with Continue", async ({ page }) => {
    await page.addInitScript(() => { window.__demoContactPickerError = "SecurityError"; });
    const dialog = await openRoot(page);
    await dialog.locator('[data-signup-age="16"]').click();
    await dialog.getByRole("button", { name: "Get Started!" }).click();
    await dialog.getByRole("button", { name: "Choose Friends" }).click();
    await expect(dialog.getByRole("button", { name: "Invite Friends" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Choose Friends" })).toBeHidden();
    await expect(dialog.locator("#signupStatus")).toHaveText("");
    if (process.env.SIGNUP_SHOTS === "1" && test.info().project.name === "android") {
        await page.screenshot({ path: `${process.env.HOME}/Desktop/validapp-flows/shots/signup-friends/05-picker-failed.png` });
    }
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("heading", { name: "Pick your school" })).toBeVisible();
});

test("browsers without a contact picker keep the friends card with an invite", async ({ page }) => {
    await page.addInitScript(() => { window.__demoNoContactPicker = true; });
    const dialog = await openRoot(page);
    await dialog.getByRole("button", { name: "Get Started!" }).click();
    await expect(dialog.getByRole("heading", { name: "Pick a Couple Friends" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Invite Friends" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Choose Friends" })).toBeHidden();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("heading", { name: "Pick your school" })).toBeVisible();
});

test("the school step searches first, falls back to ZIP, then adds a school with its grades", async ({ page }) => {
    const dialog = await openRoot(page);
    await dialog.getByRole("button", { name: "Get Started!" }).click();
    await dialog.getByRole("button", { name: "Choose Friends" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("Find schools nearby")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Back" })).toBeHidden();
    await dialog.getByLabel("ZIP code").fill("90210");
    await expect(dialog.locator("[data-signup-school]")).toHaveCount(50);
    await dialog.getByPlaceholder("School, city, or ZIP").fill("Central High School 2 Beverly Hills");
    await expect(dialog.locator("[data-signup-school]")).toHaveCount(1);
    await dialog.getByPlaceholder("School, city, or ZIP").fill("Ridgeview Academy");
    await expect(dialog.getByText('No results for "Ridgeview Academy"')).toBeVisible();
    await dialog.getByRole("button", { name: "Search by ZIP code" }).click();
    await expect(dialog.getByText("One more way to find it")).toBeVisible();
    await dialog.getByRole("button", { name: "Skip for now" }).click();

    const sheet = page.getByRole("dialog", { name: "Add Your School" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("School Name")).toHaveValue("Ridgeview Academy");
    await expect(sheet.getByLabel("School's ZIP Code")).toHaveValue("90210");
    await expect(sheet.getByText("What grades does this school have?")).toBeVisible();
    await sheet.getByLabel("From").selectOption("6");
    await sheet.getByLabel("To").selectOption("8");
    await sheet.getByRole("button", { name: "Add School" }).click();
    await expect(sheet.getByRole("heading", { name: "School Added!" })).toBeVisible();
    await sheet.getByRole("button", { name: "Select Ridgeview Academy" }).click();
    await expect(sheet).toBeHidden();
    await dialog.getByRole("button", { name: "Continue" }).click();
    // The added school's grade range limits the grade choices.
    await expect(dialog.getByRole("radio")).toHaveCount(3);
    await expect(dialog.getByRole("radio", { name: /8th Grade/ })).toBeVisible();
});

test("an existing number opens the sign-in sheet over sign-up", async ({ page }) => {
    const dialog = await openRoot(page);
    await dialog.getByRole("button", { name: "Get Started!" }).click();
    await dialog.getByRole("button", { name: "Choose Friends" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await pickSchoolBySearch(dialog);
    await dialog.getByRole("radio", { name: /Senior/ }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Phone number").fill("4155550100");
    await dialog.getByRole("button", { name: "Continue" }).click();
    const sheet = page.getByRole("dialog", { name: "Welcome Back" });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator("#authStatus")).toHaveText("An account already exists for this phone number. Please log in.");
    await expect(dialog).toBeVisible();
});

test("phone sign-in sends a code, verifies it and signs in", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");
    const sheet = page.getByRole("dialog", { name: "Welcome Back" });
    await sheet.getByRole("button", { name: "Sign in with phone number" }).click();
    await expect(sheet.getByRole("heading", { name: "Sign in with Phone" })).toBeVisible();
    await expect(sheet.getByText(/By tapping Send Code, you agree to receive a one-time authentication text/)).toBeVisible();
    await sheet.getByLabel("Phone number").fill("4155550123");
    await sheet.getByRole("button", { name: "Send Code" }).click();
    await expect(sheet.getByRole("heading", { name: "Enter Verification Code" })).toBeVisible();
    await expect(sheet.locator("#signInResend")).toHaveText(/Resend in \d+s/);
    await expect(sheet.getByRole("button", { name: "Change phone number" })).toBeVisible();
    await sheet.getByLabel("Verification code").fill("123456");
    await sheet.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
});

test("a number that is not signed up is sent to sign-up", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");
    const sheet = page.getByRole("dialog", { name: "Welcome Back" });
    await sheet.getByRole("button", { name: "Sign in with phone number" }).click();
    await sheet.getByLabel("Phone number").fill("4155550199");
    await sheet.getByRole("button", { name: "Send Code" }).click();
    const alert = page.getByRole("dialog", { name: "Number Not Signed Up" });
    await expect(alert.getByText("This phone number isn't signed up yet. We'll help you create a new account.")).toBeVisible();
    await alert.getByRole("button", { name: "Continue" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator("#signupDialog").getByRole("button", { name: "Get Started!" })).toBeVisible();
    await expect(page.locator("#signupPhone")).toHaveValue("(415) 555-0199");
});

test("phone sign-in stays hidden until the server turns it on", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1&phonelogin=0");
    const sheet = page.getByRole("dialog", { name: "Welcome Back" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Sign in with phone number" })).toBeHidden();
});

test("sign-in with postauth lands on Play after the Friends & Classmates sheet", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1&postauth=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    const friends = page.getByRole("dialog", { name: /Friends & Classmates|Classmates/ });
    await expect(friends).toBeVisible();
    await friends.getByRole("button", { name: "Continue" }).click();
    await expect(friends).toBeHidden();
    await expect(page.locator("#playPanel")).toBeVisible();
});

test("the locked Feed offers vote alerts with the iOS copy", async ({ page }) => {
    await page.goto("/app/?demo=1&locked=1&signin=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.locator(".feed-gate-card")).toBeVisible();
    const card = page.locator(".feed-gate-notification");
    // The demo has no Web Push, so the card shows only where it can do something.
    if (await card.isVisible()) {
        await expect(card.getByText("Turn on vote alerts")).toBeVisible();
        await expect(card.getByText("Know right away when someone picks you.")).toBeVisible();
    }
    expect(await page.locator(".feed-gate-card").innerHTML()).not.toContain("Don’t miss your next vote");
});

for (const [route, check] of [
    ["notification=inbox", async (page) => {
        await expect(page.locator('[data-inbox-filter="ask_me"]')).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByRole("button", { name: "Feed", exact: true })).toHaveAttribute("aria-current", "page");
    }],
    ["notification=question_submission&submission_id=1", async (page) => {
        await expect(page.getByRole("button", { name: "Profile", exact: true })).toHaveAttribute("aria-current", "page");
        await expect(page.getByRole("dialog", { name: "School Questions" })).toBeVisible();
    }],
    ["notification=feed&tab=feed", async (page) => {
        await expect(page.getByRole("button", { name: "Feed", exact: true })).toHaveAttribute("aria-current", "page");
    }],
    ["tab=play", async (page) => {
        await expect(page.getByRole("button", { name: "Play", exact: true })).toHaveAttribute("aria-current", "page");
    }],
]) test(`push link ${route} lands where iOS does`, async ({ page }) => {
    await page.goto(`/app/?demo=1&signin=1&${route}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await check(page);
    expect(new URL(page.url()).searchParams.get("notification")).toBeNull();
});

test("a push tap while the app is open routes the vote to its poll", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.evaluate(() => navigator.serviceWorker?.dispatchEvent?.(new MessageEvent("message", { data: { type: "VALID_NOTIFICATION_CLICK", url: "/app/?notification=feed&tab=feed" } })));
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toHaveAttribute("aria-current", "page");
});

test("chat pushes while Valid is open show an in-app banner that opens the chat", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker?.dispatchEvent?.(new MessageEvent("message", { data: { type: "VALID_PUSH_FOREGROUND", payload: { title: "Noah Williams", body: "New photo", url: "/app/?tab=chats&chat=chat-noah" } } })));
    const banner = page.locator("#inAppPushBanner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Noah Williams");
    await banner.click();
    await expect(page.getByRole("button", { name: "Chats", exact: true })).toHaveAttribute("aria-current", "page");
});
