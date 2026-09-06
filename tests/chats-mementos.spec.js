import { expect, test } from "@playwright/test";
const TINY_VP9_MP4 = "AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAAyZtb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAAyAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACUXRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAyAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAEAAAABAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAAMgAAAAAAAEAAAAAAcltZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAADIAAAAKAFXEAAAAAAAtaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAF0bWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAABNHN0YmwAAACoc3RzZAAAAAAAAAABAAAAmHZwMDkAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAEAAQAEgAAABIAAAAAAAAAAEYTGF2YzYyLjExLjEwMCBsaWJ2cHgtdnA5AAAAAAAAAAAY//8AAAAUdnBjQwEAAAAACoICAgIAAAAAAApmaWVsAQAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAPeAAAAAAAAAAYc3R0cwAAAAAAAAABAAAABQAAAgAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAABQAAAAEAAAAoc3RzegAAAAAAAAAAAAAABQAAACcAAAAPAAAADwAAAA8AAAAPAAAAFHN0Y28AAAAAAAAAAQAAA1IAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYyLjMuMTAwAAAACGZyZWUAAABrbWRhdIJJg0IAAPAA9gA4JBwYSgAAMGAAABC///cdr////1/f////8irAAIYAQJKcAFAAAAMgAABCQIYAQJKcAE7gAAMgAABCQIYAQJKcAFAAAAMgAABCQIYAQJKcAE1AAAMgAABCQIYAQJKcAFAAAAMgAABCQIYAQJKcAE=";

const TINY_MP4 = "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAN0bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAMgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAp90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAMgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAADIAAAEAAABAAAAAAIXbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAACgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABwm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAYJzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4xMS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAMg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAHcQAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAFAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAOGN0dHMAAAAAAAAABQAAAAEAAAQAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAUAAAABAAAAKHN0c3oAAAAAAAAAAAAAAAUAAALKAAAADAAAAAwAAAAMAAAADAAAABRzdGNvAAAAAAAAAAEAAAOkAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2Mi4zLjEwMAAAAAhmcmVlAAADAm1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAUZYiEADP//t8y+BTNxYnOzIBcnpcAAAAIQZokbEK//sAAAAAIQZ5CeIX/wYEAAAAIAZ5hdEK/xIAAAAAIAZ5jakK/xIE=";

async function signInToDemo(page, suffix = "") {
    await page.goto(`/app/?demo=1&signin=1${suffix}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Chats", exact: true })).toBeVisible();
}

test.describe("Memento calendar boundaries", () => {
    test.use({ timezoneId: "America/New_York" });

    test("the demo ledger follows the device calendar across UTC midnight", async ({ page }) => {
        await page.addInitScript((fixedNow) => {
            const NativeDate = Date;
            class FixedDate extends NativeDate {
                constructor(...args) {
                    super(...(args.length ? args : [fixedNow]));
                }

                static now() {
                    return fixedNow;
                }
            }
            Object.defineProperty(globalThis, "Date", { value: FixedDate, configurable: true });
        }, Date.parse("2030-01-02T02:30:00Z"));
        await signInToDemo(page);
        await page.getByRole("button", { name: "Chats", exact: true }).click();
        await page.getByRole("button", { name: /Weekend Crew/ }).click();
        await expect(page.locator(".chat-daily-row > button")).toContainText("Take today's Memento");
        await page.locator(".chat-daily-row > button").click();
        await expect(page.getByRole("dialog", { name: "Create a Memento" })).toBeVisible();
        const createdLedgerDate = await page.evaluate(async () => {
            const { DemoAPI } = await import("/app/demo-api.js");
            const demo = new DemoAPI();
            const chat = await demo.createChat("demo-user", ["classmate-1"], null);
            return (await demo.getChatDailyRow("demo-user", chat.id)).ledger_date;
        });
        expect(createdLedgerDate).toBe("2030-01-01");
    });
});

test("Chats lazy-loads its feature bundle and shows unread conversations and invitations", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");
    const chatResources = () => page.evaluate(() => performance.getEntriesByType("resource")
        .map((entry) => new URL(entry.name).pathname)
        .filter((path) => path.endsWith(".js") && (path.includes("/app/chat/") || path.endsWith("/app/routes/chats.js"))));
    expect(await chatResources()).toEqual([]);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await expect(page.getByText("Weekend Crew", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
    await expect(page.locator("#chatsTabBadge")).toHaveText("2");
    await expect.poll(chatResources).toContain("/app/routes/chats.js");
    await expect.poll(chatResources).toContain("/app/chat/index.js");
});

test("declining an invitation removes it from the authoritative chat list", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await expect(page.getByText("Art Club", { exact: true })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Decline" }).click();
    await expect(page.getByText("Art Club", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
});

test("Memento reciprocity keeps locked messages out of the DOM and unlocks after posting", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Weekend Crew/ }).click();
    await expect(page.locator(".chat-timeline")).toHaveText(/Chat locked/);
    await expect(page.locator(".chat-message")).toHaveCount(0);
    await expect(page.locator(".chat-composer")).toBeHidden();

    await page.locator(".chat-daily-row > button").click();
    const composer = page.getByRole("dialog", { name: "Create a Memento" });
    await composer.locator('input[type="file"]').setInputFiles("assets/AppIconV2.png");
    await expect(composer.getByRole("button", { name: "Share to this chat" })).toBeEnabled();
    await composer.getByRole("button", { name: "Share to this chat" }).click();

    await expect(page.getByText("Today's Mementos", { exact: true })).toBeVisible();
    await expect(page.locator(".chat-memento-week button")).toHaveCount(7);
    await expect(page.locator(".chat-memento-week button.selected")).toHaveCount(1);
    await expect(page.locator(".chat-message")).toHaveCount(5);
    await expect(page.locator(".chat-composer")).toBeVisible();
    await expect(page.getByText(/Memento shared · \+10 Aura/)).toBeVisible();
});

test("Memento reciprocity offers the same skip-for-today alternative as iOS", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Weekend Crew/ }).click();
    await page.locator(".chat-daily-row > button").click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Skip for today" }).click();
    await expect(page.getByText("Chat unlocked for today", { exact: true })).toBeVisible();
    await expect(page.locator(".chat-message")).toHaveCount(4);
    await expect(page.locator(".chat-composer")).toBeVisible();
});

test("one Memento can be shared to multiple accepted chats", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Weekend Crew/ }).click();
    await page.locator(".chat-daily-row > button").click();
    const composer = page.getByRole("dialog", { name: "Create a Memento" });
    await composer.locator('input[type="file"]').setInputFiles("assets/AppIconV2.png");
    await composer.getByRole("checkbox", { name: "Noah Williams" }).check();
    await composer.getByRole("button", { name: "Share to this chat" }).click();
    await expect(page.getByText(/Memento shared to 2 chats/)).toBeVisible();
});

test("Memento gallery can reply, react, and safely reshare its authoritative entry", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: /Jules Rivera's Memento/ }).click();
    const viewer = page.getByRole("dialog", { name: "Chat media" });
    await viewer.getByRole("button", { name: "Reply" }).click();
    await expect(page.locator(".chat-reply-draft")).toContainText("Memento");
    await page.getByRole("button", { name: /Jules Rivera's Memento/ }).click();
    await viewer.getByRole("button", { name: /React/ }).click();
    await expect(page.locator('[data-message-id="msg-n2"] .chat-reaction-summary')).toContainText("❤️ 1");
    const before = await page.locator(".memento-label").count();
    await page.getByRole("button", { name: /Jules Rivera's Memento/ }).click();
    await viewer.getByRole("button", { name: "Share", exact: true }).click();
    await expect(page.getByText("Memento shared", { exact: true })).toBeVisible();
    await expect(page.locator(".memento-label")).toHaveCount(before + 1);
});

test("chat sends reconcile optimistic identity and support replies and reactions", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();

    await page.getByRole("textbox", { name: "Message" }).fill("One responsive bubble");
    await page.getByRole("button", { name: "Send message" }).click();
    const message = page.locator(".chat-message").filter({ hasText: "One responsive bubble" });
    await expect(message).toHaveCount(1);
    await expect(message).toHaveClass(/sent/);
    await expect(message).not.toContainText("Sending…");

    await expect(message.locator(".chat-message-actions")).toBeHidden();
    await message.getByRole("button", { name: "Message actions" }).click();
    await expect(message.locator(".chat-message-actions")).toBeVisible();
    await message.getByRole("button", { name: "React love" }).click();
    await expect(message.locator(".chat-reaction-summary")).toContainText("❤️ 1");
    await message.getByRole("button", { name: "View reactions" }).click();
    const reactors = page.getByRole("dialog", { name: "Message reactions" });
    await expect(reactors).toContainText("Maya Chen");
    await reactors.getByRole("button", { name: "Done" }).click();
    await message.getByRole("button", { name: "Message actions" }).click();
    await message.getByRole("button", { name: "Reply" }).click();
    await expect(page.locator(".chat-reply-draft")).toContainText("One responsive bubble");
    await page.getByRole("textbox", { name: "Message" }).fill("A threaded reply");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator(".chat-message").filter({ hasText: "A threaded reply" })).toContainText("One responsive bubble");
});

test("users can create a named group and return to the list from the active Chats tab", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "Start a chat" }).click();
    const checkboxes = page.getByRole("checkbox");
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    await page.getByPlaceholder("Name your group").fill("Project Crew");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator(".chat-room-title")).toContainText("Project Crew");
    await expect(page).toHaveURL(/tab=chats&chat=chat-/);

    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await expect(page.locator('[data-chat-screen="list"] .chat-row').filter({ hasText: "Project Crew" })).toBeVisible();
    await expect(page).toHaveURL(/tab=chats(?!.*chat=)/);
});

test("group owners can rename a chat and invite another classmate", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Weekend Crew/ }).click();
    await page.getByRole("button", { name: "Chat settings" }).click();
    const settings = page.getByRole("dialog", { name: "Chat settings" });
    await settings.locator(".chat-name-setting input").fill("Friday Crew");
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".chat-room-title")).toContainText("Friday Crew");

    await settings.getByRole("button", { name: "Add people" }).click();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.locator(".chat-room-title")).toContainText("5 people");
});

test("group owners can remove a member and refresh the authoritative roster", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Weekend Crew/ }).click();
    await page.getByRole("button", { name: "Chat settings" }).click();
    const settings = page.getByRole("dialog", { name: "Chat settings" });
    page.once("dialog", (dialog) => dialog.accept());
    await settings.getByRole("button", { name: "Remove Maya Chen" }).click();
    await expect(settings.getByText("Maya Chen", { exact: true })).toHaveCount(0);
    await expect(page.locator(".chat-room-title")).toContainText("3 people");
});

test("leaving a chat reloads the list without the ended membership", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Chat settings" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("dialog", { name: "Chat settings" }).getByRole("button", { name: "Leave chat" }).click();
    await expect(page.locator('[data-chat-screen="list"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /Noah Williams/ })).toHaveCount(0);
});

test("notification levels remain editable after each authoritative update", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Chat settings" }).click();
    const setting = page.getByRole("dialog", { name: "Chat settings" }).getByLabel("Notifications");
    await setting.selectOption("muted");
    await expect(setting).toHaveValue("muted");
    await setting.selectOption("daily_only");
    await expect(setting).toHaveValue("daily_only");
});

test("group owners can prepare and replace the authoritative group photo", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Weekend Crew/ }).click();
    await page.getByRole("button", { name: "Chat settings" }).click();
    await page.getByLabel("Choose group photo").setInputFiles("assets/AppIconV2.png");
    await expect(page.getByText("Group photo updated", { exact: true })).toBeVisible();
});

test("chat settings expose the authoritative account-wide block action", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Weekend Crew/ }).click();
    await page.getByRole("button", { name: "Chat settings" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /Block Maya Chen/ }).click();
    await expect(page.getByText("Person blocked", { exact: true })).toBeVisible();
});

test("an exact message deep link restores the requested conversation and target", async ({ page }) => {
    await signInToDemo(page, "&tab=chats&chat=chat-noah&message=msg-n3");
    await expect(page.locator(".chat-room-title")).toContainText("Noah Williams");
    const target = page.locator('[data-message-id="msg-n3"]');
    await expect(target).toContainText("That was hilarious 😂");
    await expect(target).toHaveClass(/deep-linked/);
    await target.getByRole("button", { name: "Read" }).click();
    const receipts = page.getByRole("dialog", { name: "Read receipts" });
    await expect(receipts).toContainText("Noah Williams");
    await receipts.getByRole("button", { name: "Done" }).click();
});

test("hide-for-me removes only the local row while unsend renders a tombstone", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();

    const incoming = page.locator('[data-message-id="msg-n1"]');
    await incoming.getByRole("button", { name: "Message actions" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await incoming.getByRole("button", { name: "Hide for me" }).click();
    await expect(incoming).toHaveCount(0);

    const mine = page.locator('[data-message-id="msg-n3"]');
    await mine.getByRole("button", { name: "Message actions" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await mine.getByRole("button", { name: "Unsend" }).click();
    await expect(mine).toHaveCount(0);
    await expect(page.getByText("Message removed", { exact: true })).toBeVisible();
});

test("Chats and Mementos honor the system dark color scheme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await expect(page.locator(".chat-bubble").first()).toBeVisible();
    const colors = await page.evaluate(() => ({
        scheme: getComputedStyle(document.documentElement).colorScheme,
        page: getComputedStyle(document.body).backgroundColor,
        card: getComputedStyle(document.querySelector(".chat-bubble")).backgroundColor,
        composer: getComputedStyle(document.querySelector(".chat-composer")).backgroundColor,
    }));
    expect(colors.scheme).toBe("dark");
    expect(colors.page).toBe("rgb(11, 37, 40)");
    expect(colors.card).not.toBe("rgb(255, 255, 255)");
    expect(colors.composer).not.toBe("rgb(255, 255, 255)");
});

test("explicit chat search opens the exact authoritative message", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search chats and messages" }).fill("hilarious");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const result = page.getByRole("button", { name: /Noah Williams.*That was hilarious/ });
    await expect(result).toBeVisible();
    await result.click();
    await expect(page).toHaveURL(/chat=chat-noah.*message=msg-n3/);
    await expect(page.locator('[data-message-id="msg-n3"]')).toHaveClass(/deep-linked/);
});

test("chat media sends a prepared photo through upload, finalize, and message creation", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Send media or a sticker" }).click();
    const dialog = page.getByRole("dialog", { name: "Send media" });
    await dialog.locator(".chat-media-file-input").setInputFiles("assets/AppIconV2.png");
    await expect(dialog.getByText("Photo ready to send")).toBeVisible();
    await dialog.getByLabel("Text overlay").fill("After practice");
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await expect(dialog).toBeHidden();
    const sent = page.locator(".chat-message.mine").last();
    await expect(sent.getByRole("img", { name: "Photo" })).toBeVisible();
    await expect(sent).toContainText("After practice");
    await expect(page.getByText("Photo sent", { exact: true })).toBeVisible();
});

test("chat media rejects an undecodable MP4 before upload", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Send media or a sticker" }).click();
    const dialog = page.getByRole("dialog", { name: "Send media" });
    await dialog.locator(".chat-media-file-input").setInputFiles({ name: "broken.mp4", mimeType: "video/mp4", buffer: Buffer.from("not an mp4") });
    await expect(dialog.getByText("That video could not be read.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
});

test("voice composer keeps an M4A picker fallback when a browser cannot record compatible audio", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, "MediaRecorder", { configurable: true, value: undefined });
    });
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Send media or a sticker" }).click();
    const dialog = page.getByRole("dialog", { name: "Send media" });
    await expect(dialog.getByLabel("Voice message")).toHaveAttribute("accept", "audio/mp4,.m4a");
    await expect(dialog.getByRole("button", { name: "Record voice message" })).toBeHidden();
});

test("compatible browsers can record an MP4 voice message locally before upload", async ({ page }) => {
    await page.addInitScript(() => {
        const stream = { getTracks: () => [{ stop() {} }] };
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: { getUserMedia: async () => stream },
        });
        class FakeMediaRecorder extends EventTarget {
            static isTypeSupported(type) { return type.startsWith("audio/mp4"); }
            constructor(inputStream, options) {
                super();
                this.stream = inputStream;
                this.mimeType = options.mimeType;
                this.state = "inactive";
            }
            start() { this.state = "recording"; }
            stop() {
                this.state = "inactive";
                this.dispatchEvent(new MessageEvent("dataavailable", { data: new Blob(["voice"], { type: "audio/mp4" }) }));
                this.dispatchEvent(new Event("stop"));
            }
        }
        Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeMediaRecorder });
    });
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Send media or a sticker" }).click();
    const dialog = page.getByRole("dialog", { name: "Send media" });
    const record = dialog.getByRole("button", { name: "Record voice message" });
    await expect(record).toBeVisible();
    await record.click();
    await expect(dialog.getByText("Recording locally. Tap Stop when you're done.")).toBeVisible();
    await dialog.getByRole("button", { name: /Stop · 0:00/ }).click();
    await expect(dialog.getByText("Voice message ready to send")).toBeVisible();
    await expect(dialog.locator("audio")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
});

test("view-once media starts each server session only after reveal and stops after two views", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    const message = page.locator('[data-message-id="msg-n4"]');
    await expect(message.getByRole("button", { name: /View once photo.*2 views left/ })).toBeVisible();
    await message.getByRole("button", { name: /View once photo/ }).click();
    const viewer = page.getByRole("dialog", { name: "Chat media" });
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText("View once");
    await expect(viewer).toContainText("Game night");
    await viewer.getByRole("button", { name: "Close" }).click();
    await expect(message.getByRole("button", { name: /View once photo.*1 view left/ })).toBeVisible();
    await message.getByRole("button", { name: /View once photo/ }).click();
    await expect(viewer).toBeVisible();
    await viewer.getByRole("button", { name: "Close" }).click();
    await expect(message.getByRole("button", { name: /Opened.*No views left/ })).toBeDisabled();
});

test("view-once senders can inspect authoritative recipient receipts", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.locator('[data-message-id="msg-n5"]').getByRole("button", { name: "View receipts" }).click();
    const receipts = page.getByRole("dialog", { name: "Read receipts" });
    await expect(receipts).toContainText("Noah Williams");
    await expect(receipts).toContainText("1×");
});

test("saved stickers send through the authoritative chat message contract", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Send media or a sticker" }).click();
    const dialog = page.getByRole("dialog", { name: "Send media" });
    await dialog.getByRole("button", { name: "Send saved sticker" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".chat-message.mine").last().getByRole("img", { name: "Sticker" })).toBeVisible();
});
