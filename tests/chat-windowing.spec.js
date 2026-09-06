import { expect, test } from "@playwright/test";

async function mountLongConversation(page, { deepLink = false } = {}) {
    await page.goto("/app/?signin=1");
    return page.evaluate(async (shouldDeepLink) => {
        const { createChatsView } = await import("/app/chat/index.js");
        const user = { id: "window-user", first_name: "Jules" };
        const chat = {
            id: "window-chat",
            display_name: "Long conversation",
            membership_status: "accepted",
            role: "member",
            accepted_count: 2,
            pending_count: 0,
            unread_count: 0,
            notification_level: "all",
            updated_at: new Date().toISOString(),
        };
        const messages = Array.from({ length: 500 }, (_, offset) => ({
            id: `history-${offset + 1}`,
            chat_id: chat.id,
            room_sequence: offset + 1,
            sender_user_id: (offset + 1) % 2 ? "classmate" : user.id,
            sender_first_name: (offset + 1) % 2 ? "Maya" : "Jules",
            viewer_is_sender: (offset + 1) % 2 === 0,
            kind: "text",
            body: `History message ${offset + 1}`,
            reply_to_message_id: offset === 499 ? "history-10" : null,
            status: "active",
            reaction_count: 0,
            reaction_summary: {},
            created_at: new Date(2_000_000_000_000 + offset * 1_000).toISOString(),
            updated_at: new Date(2_000_000_000_000 + offset * 1_000).toISOString(),
        }));
        const api = {
            assetURL: (value) => value,
            getChats: async () => ({ items: [chat] }),
            getChat: async () => ({ chat, members: [] }),
            getChatMessages: async () => ({ items: messages, next_before_sequence: null, latest_sequence: 500 }),
            markChatRead: async () => ({}),
        };
        const root = document.createElement("div");
        root.id = "window-test-root";
        document.body.append(root);
        const view = createChatsView({
            root,
            api,
            getUser: () => user,
            getConfig: () => ({
                enable_chats: true,
                enable_web_chats: true,
                enable_chat_daily_ledger: false,
                enable_web_mementos: false,
                enable_web_calls: false,
            }),
            showToast: () => {},
        });
        if (shouldDeepLink) history.replaceState(null, "", "/app/?signin=1&chat=window-chat&message=history-10");
        await view.activate({});
        if (!shouldDeepLink) await view.openChat(chat.id, { updateHistory: false });
        return { stored: view.store.messages().length };
    }, deepLink);
}

test("message-window controller traverses a 500-message history with a fixed bound", async ({ page }) => {
    await page.goto("/app/?signin=1");
    const result = await page.evaluate(async () => {
        const { createMessageWindow, MAX_RENDERED_MESSAGES } = await import("/app/chat/message-window.js");
        const items = Array.from({ length: 500 }, (_, index) => ({ id: `message-${index + 1}` }));
        const windowed = createMessageWindow();
        const counts = [];
        let current = windowed.range("chat-a", items);
        counts.push(current.items.length);
        while (current.hiddenBefore) {
            current = windowed.previous("chat-a", items);
            counts.push(current.items.length);
        }
        const oldest = current.items[0].id;
        while (current.hiddenAfter) {
            current = windowed.next("chat-a", items);
            counts.push(current.items.length);
        }
        const newest = current.items.at(-1).id;
        const focused = windowed.range("chat-a", items, { focusId: "message-10" });
        const otherChat = windowed.range("chat-b", items.slice(0, 200));
        return {
            max: Math.max(...counts),
            constant: MAX_RENDERED_MESSAGES,
            oldest,
            newest,
            focusContainsTarget: focused.items.some((item) => item.id === "message-10"),
            otherChatEndsAt: otherChat.items.at(-1).id,
        };
    });
    expect(result).toEqual({
        max: 120,
        constant: 120,
        oldest: "message-1",
        newest: "message-500",
        focusContainsTarget: true,
        otherChatEndsAt: "message-200",
    });
});

test("a long chat keeps the full bounded store but renders no more than 120 messages", async ({ page }) => {
    const mounted = await mountLongConversation(page);
    expect(mounted.stored).toBe(500);
    const root = page.locator("#window-test-root");
    await expect(root.locator(".chat-message")).toHaveCount(120);
    await expect(root.getByRole("button", { name: /Show earlier messages 380 earlier/ })).toBeVisible();
    await expect(root.locator('[data-message-id="history-500"]')).toHaveAttribute("aria-posinset", "500");
    await expect(root.locator('[data-message-id="history-500"]')).toHaveAttribute("aria-setsize", "500");
    await expect(root.locator('[data-message-id="history-1"]')).toHaveCount(0);
});

test("a reply reveals its hidden target without allowing DOM growth", async ({ page }) => {
    await mountLongConversation(page);
    const root = page.locator("#window-test-root");
    await root.locator('[data-message-id="history-500"] [data-scroll-message="history-10"]').click();
    await expect(root.locator('[data-message-id="history-10"]')).toBeVisible();
    await expect(root.locator('[data-message-id="history-10"]')).toHaveAttribute("aria-posinset", "10");
    await expect(root.getByRole("button", { name: /Show newer messages/ })).toBeVisible();
    expect(await root.locator(".chat-message").count()).toBeLessThanOrEqual(120);
});

test("an exact message deep link reveals a target outside the initial window", async ({ page }) => {
    await mountLongConversation(page, { deepLink: true });
    const root = page.locator("#window-test-root");
    await expect(root.locator('[data-message-id="history-10"]')).toBeVisible();
    await expect(root.locator('[data-message-id="history-10"]')).toHaveClass(/deep-linked/);
    await expect(root.locator('[data-message-id="history-10"]')).toHaveAttribute("aria-posinset", "10");
    expect(await root.locator(".chat-message").count()).toBeLessThanOrEqual(120);
});

test("accessible history controls reach both ends through repeated shifts", async ({ page }) => {
    await mountLongConversation(page);
    const root = page.locator("#window-test-root");
    const earlier = root.locator("[data-show-older-messages]");
    await earlier.click();
    await expect(root.locator('[data-message-id="history-381"]')).toBeVisible();
    await expect.poll(() => root.evaluate((container) => {
        const timeline = container.querySelector(".chat-timeline");
        const anchor = container.querySelector('[data-message-id="history-381"]');
        const timelineRect = timeline.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        return Math.abs((anchorRect.top + anchorRect.height / 2) - (timelineRect.top + timelineRect.height / 2));
    })).toBeLessThan(3);
    for (let shift = 1; shift < 6 && await earlier.count(); shift += 1) {
        await earlier.click();
        expect(await root.locator(".chat-message").count()).toBeLessThanOrEqual(120);
    }
    await expect(root.locator('[data-message-id="history-1"]')).toBeVisible();
    await expect(earlier).toHaveCount(0);

    const newer = root.locator("[data-show-newer-messages]");
    for (let shift = 0; shift < 6 && await newer.count(); shift += 1) {
        await newer.click();
        expect(await root.locator(".chat-message").count()).toBeLessThanOrEqual(120);
    }
    await expect(root.locator('[data-message-id="history-500"]')).toBeVisible();
    await expect(newer).toHaveCount(0);
});
