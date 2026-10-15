import { test, expect } from "@playwright/test";

// Profile and settings flows that follow iOS 1.6034 step by step
// (SettingsView, NotificationSettingsSheet, InformationEditSheet,
// DeleteAccountModal, AccountDeletionPendingView, GodModeCard / EarnView /
// PlanSheet, Vault).

async function openProfile(page, query = "") {
    await page.goto(`/app/?demo=1&signin=1${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    const enrollment = page.locator("#passkeyEnrollmentDialog");
    if (query.includes("passkeys=0")) {
        await expect(enrollment).toBeVisible();
        await enrollment.getByRole("button", { name: "Not now" }).click();
    }
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.locator("#profileCard h3")).toHaveText("Jules Rivera");
}

test("settings follow iOS order: Appearance, one Settings card, Feedback, Sign out", async ({ page }) => {
    await openProfile(page);
    const order = await page.locator("#profilePanel").evaluate((panel) => [...panel.children]
        .filter((child) => !child.classList.contains("hidden") && getComputedStyle(child).display !== "none")
        .map((child) => child.id || child.className.split(" ")[0]));
    const at = (name) => order.indexOf(name);
    expect(at("inviteFriendsSection")).toBeLessThan(at("device-preferences"));
    expect(at("device-preferences")).toBeLessThan(at("privacySettings"));
    expect(at("privacySettings")).toBeLessThan(at("feedbackButton"));
    expect(at("feedbackButton")).toBeLessThan(at("profileSignOutButton"));
    const settings = page.locator("#privacySettings");
    await expect(settings.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(settings.locator(".settings-row strong")).toHaveText(["Notifications", "Activity Status", "Blocked Users"]);
    await expect(page.locator("#notificationStatusText")).toHaveText("All on");
    await expect(page.getByText("System settings")).toHaveCount(0);
    await expect(page.getByText("Privacy & Safety")).toHaveCount(0);
    // With a passkey there is no CTA, and Sign out needs no warning.
    await expect(page.locator("#addPasskeyButton")).toBeHidden();
});

test("Notifications sheet saves each switch, summarises it, and flips back on failure", async ({ page }) => {
    await openProfile(page, "&notifoff=activity,reminders");
    await expect(page.locator("#notificationStatusText")).toHaveText("Votes, Chats");
    await page.locator("#notificationButton").click();
    const sheet = page.getByRole("dialog", { name: "Notifications" });
    await expect(sheet.getByText("Notifications aren't on yet")).toBeVisible();
    await expect(sheet.getByText("Your choices below are saved for when you turn them on.")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Turn on notifications" })).toBeVisible();
    await expect(sheet.getByText("Calls and safety notices always come through. To mute one chat, open it and tap its name.")).toBeVisible();
    const votes = sheet.getByRole("switch", { name: "Votes" });
    const activity = sheet.getByRole("switch", { name: "Activity" });
    await expect(votes).toHaveAttribute("aria-checked", "true");
    await expect(activity).toHaveAttribute("aria-checked", "false");
    await activity.click();
    await expect(activity).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#notificationStatusText")).toHaveText("Votes, Chats, Activity");
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
});

test("a failed Notifications save puts the switch back and says so", async ({ page }) => {
    await openProfile(page, "&notiffail=1");
    await page.locator("#notificationButton").click();
    const sheet = page.getByRole("dialog", { name: "Notifications" });
    const chats = sheet.getByRole("switch", { name: "Chats" });
    await chats.click();
    await expect(chats).toHaveAttribute("aria-checked", "false");
    await expect(sheet.getByText("Couldn't save Chats. Check your connection and try again.")).toBeVisible();
    await expect(chats).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#notificationStatusText")).toHaveText("All on");
});

test("an account without a passkey sees the CTA above Sign out, and Sign out warns first", async ({ page }) => {
    await openProfile(page, "&passkeys=0");
    const cta = page.locator("#addPasskeyButton");
    await expect(cta).toBeVisible();
    await expect(cta).toContainText("Don't lose your account! Set up a passkey");
    expect(await page.evaluate(() => document.querySelector("#addPasskeyButton").nextElementSibling?.id)).toBe("profileSignOutButton");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    const warning = page.getByRole("dialog", { name: "Don't Lose Your Account" });
    await expect(warning).toContainText("If you lose access to this phone number after signing out");
    const buttons = warning.locator(".ui-sheet-actions button");
    // ConfirmationModal: Cancel ("Sign Out Anyway") left, Set Up Passkey right.
    await expect(buttons.nth(0)).toHaveText("Sign Out Anyway");
    await expect(buttons.nth(1)).toHaveText("Set Up Passkey");
    await warning.getByRole("button", { name: "Set Up Passkey" }).click();
    await expect(cta).toBeHidden();
});

test("Edit profile adds Gender, shows it in review, and saves it", async ({ page }) => {
    await openProfile(page);
    await page.getByRole("button", { name: "Profile information" }).click();
    const sheet = page.locator("#profileDialog");
    await expect(sheet.getByRole("button", { name: /Gender Girl/ })).toBeVisible();
    await sheet.getByRole("button", { name: /Name Jules Rivera/ }).click();
    await expect(sheet.getByText("Use at least two letters for each name. Hyphens and apostrophes are okay.")).toBeVisible();
    await sheet.locator("#profileEditorBack").click();
    await sheet.getByRole("button", { name: /Gender Girl/ }).click();
    await sheet.getByRole("radio", { name: "Non-binary" }).click();
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet.locator("#profileGenderBadge")).toHaveText("Changed");
    await sheet.getByRole("button", { name: "Review 1 change" }).click();
    await expect(sheet.locator("#profileReviewRows")).toContainText("Gender");
    await expect(sheet.locator("#profileReviewRows")).toContainText("Non-binary");
    await expect(sheet.getByText("Saving starts the 14-day cooldown for username, name, school, grade, and gender.")).toBeVisible();
    await sheet.getByRole("button", { name: "Confirm and save" }).click();
    await expect(page.locator("#toast")).toContainText("Profile updated");
    await page.getByRole("button", { name: "Profile information" }).click();
    await expect(sheet.getByRole("button", { name: /Gender Non-binary/ })).toBeVisible();
    await sheet.getByRole("button", { name: /Gender Non-binary/ }).click();
    await sheet.getByRole("radio", { name: "Boy" }).click();
    await sheet.getByRole("button", { name: "Done" }).click();
    await sheet.getByRole("button", { name: "Cancel" }).click();
    const discard = page.getByRole("dialog", { name: "Discard your changes?" });
    await expect(discard).toContainText("Your profile has not been changed yet.");
    await discard.getByRole("button", { name: "Discard" }).click();
    await expect(sheet).toBeHidden();
});

test("the bio sheet matches iOS", async ({ page }) => {
    await openProfile(page);
    await page.locator("[data-edit-bio]").click();
    const bio = page.getByRole("dialog", { name: "Bio" });
    await expect(bio.getByRole("button", { name: "Cancel" })).toBeVisible();
    await bio.getByRole("textbox", { name: "Bio" }).fill("Hi");
    await expect(bio.getByText("2/160")).toBeVisible();
    await expect(bio.getByRole("button", { name: "Save Bio" })).toBeVisible();
    await bio.getByRole("button", { name: "Cancel" }).click();
    await expect(bio).toBeHidden();
});

test("delete account: no typing, hide-from-polls, then the signed-in countdown", async ({ page }) => {
    await openProfile(page, "&godmode=1");
    await page.getByRole("button", { name: "Profile information" }).click();
    await page.locator("#profileDialog").getByRole("button", { name: "Delete account" }).click();
    const modal = page.getByRole("dialog", { name: "Delete Account?" });
    await expect(modal).toContainText("We'll delete your account in 5 days. You can keep it from the countdown screen any time before then.");
    await expect(modal).toContainText("Once it's gone, friends who have your number saved can still vote for you in polls.");
    await expect(modal).toContainText("Deleting your account doesn't cancel your web subscription.");
    await expect(modal.getByRole("textbox")).toHaveCount(0);
    const hide = modal.getByRole("switch", { name: "Hide my number from polls" });
    await expect(hide).toHaveAttribute("aria-checked", "false");
    await hide.click();
    await expect(modal).toContainText("No one will be able to vote for you in polls, even friends who have your number saved.");
    const actions = modal.locator(".delete-account-actions button");
    await expect(actions).toHaveText(["Cancel", "Delete account"]);
    await actions.nth(1).click();
    const countdown = page.getByRole("dialog", { name: "Account deletion scheduled" });
    await expect(countdown).toBeVisible();
    await expect(countdown.getByText("Your data will be deleted in")).toBeVisible();
    await expect(countdown.locator('[data-countdown-unit="days"]')).toHaveText("04 d");
    await expect(countdown).toContainText("No one can vote for you in polls, even friends who have your number saved, until you come back.");
    await expect(page.locator("body")).toHaveClass(/authenticated/);
    await countdown.getByRole("button", { name: "Keep my account" }).click();
    await expect(countdown).toBeHidden();
    await expect(page.locator("#toast")).toContainText("Your account is staying on Valid");
});

test("deletion without a passkey: Set Up Passkey is the main button", async ({ page }) => {
    await openProfile(page, "&passkeys=0");
    await page.getByRole("button", { name: "Profile information" }).click();
    await page.locator("#profileDialog").getByRole("button", { name: "Delete account" }).click();
    const warning = page.getByRole("dialog", { name: "Don't Lose Your Account" });
    await expect(warning).toContainText("If you delete the app and lose access to this phone number during the 5-day countdown");
    await expect(warning.locator(".ui-sheet-actions button")).toHaveText(["Delete Anyway", "Set Up Passkey"]);
});

test("Invite Friends, Purchases and the School card use iOS copy", async ({ page }) => {
    await openProfile(page, "&locked=1");
    const invite = page.locator("#profileInviteCard");
    await expect(invite).toContainText("Get 5 verified friends to join for \u{1F451} GOD MODE");
    await expect(invite).toContainText("Qualifying invites: 1 / 5");
    await expect(invite.getByRole("button", { name: "Invite via Snapchat" })).toBeVisible();
    await expect(invite.getByRole("button", { name: "Invite via iMessage" })).toBeVisible();
    await expect(invite.getByRole("button", { name: /Or earn God Mode through our Creator program/ })).toBeVisible();
    const purchases = page.locator("#auraPurchases");
    await expect(purchases).toContainText("Guaranteed to find out what your classmates think of you \u{1F4AC}");
    await expect(purchases).toContainText("Target a classmate");
    await expect(purchases).toContainText("They won't know who targeted them \u{1F92B}");
    await expect(purchases).toContainText("Anonymously create a poll that your school will answer.");
    const school = page.locator("#schoolCard");
    await expect(school.getByRole("button", { name: "Vote to unlock" })).toBeVisible();
    await school.getByRole("button", { name: "Vote to unlock" }).click();
    await expect(page.locator("#playPanel")).toBeVisible();
});

test("God Mode card, Earn chooser and paywall terms match iOS", async ({ page }) => {
    await openProfile(page);
    const card = page.locator("#godModeCard");
    await expect(card).toContainText("$6.99/week");
    await expect(card).toContainText("2 weekly reveals for voters or anonymous question authors.");
    await expect(card.getByRole("button", { name: "Start God Mode" })).toHaveText("Start God Mode");
    await card.getByRole("button", { name: "Start God Mode" }).click();
    const pitch = page.getByRole("dialog", { name: "God Mode", exact: true });
    await expect(pitch).toContainText("Reveal voters or anonymous school-question authors up to 2 times every week.");
    await expect(pitch).toContainText("Payment is charged by Stripe at checkout and renews every week until you cancel.");
    await expect(pitch.getByRole("button", { name: /Earn God Mode/ })).toContainText("Invite friends or join our Creator program");
    await pitch.getByRole("button", { name: /Earn God Mode/ }).click();
    const earn = page.getByRole("dialog", { name: "Earn God Mode" });
    await expect(earn.getByRole("button", { name: /Invite 5 friends/ })).toContainText("1 / 5 qualifying invites");
    await expect(earn.getByText("OR", { exact: true })).toBeVisible();
    await expect(earn.getByRole("button", { name: /Join our Creator program/ })).toContainText("Post a reel, hit 10k views");
});

test("God Mode subscribers see Active and no store-billing paragraph", async ({ page }) => {
    await openProfile(page, "&godmode=1");
    const card = page.locator("#godModeCard");
    await expect(card).toContainText("God Mode Active");
    await expect(card).toContainText("✨ Active");
    await expect(card).not.toContainText("Billing stays with the store");
});

test("a failed web payment shows the card-update row", async ({ page }) => {
    await openProfile(page, "&godmode=1&godmodebilling=past_due");
    await page.getByRole("button", { name: "Profile information" }).click();
    const row = page.locator("#godModeBillingRow");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Payment failed — update your card");
    await expect(row).toContainText("Manage billing");
    await expect(page.locator("#godModeUnsubscribeButton")).toBeHidden();
});

test("Memories has no Refresh button and shows processing videos", async ({ page }) => {
    await openProfile(page, "&vaultprocessing=1");
    await page.locator("#memoriesEntry button").first().click();
    const screen = page.locator("#vaultScreen");
    await expect(screen).toBeVisible();
    await expect(screen.getByRole("button", { name: "Refresh" })).toHaveCount(0);
    await screen.locator('[data-vault-open="vault-demo-003"]').click();
    await expect(screen.getByText("Processing video…")).toBeVisible();
    await expect(screen.getByText("It will play here as soon as it's ready.")).toBeVisible();
});
