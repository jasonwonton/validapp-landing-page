import { expect, test } from "@playwright/test";

async function mountRecoveryChat(page, shouldFail) {
    return page.evaluate(async (fail) => {
        const [{ createChatsView }, outbox] = await Promise.all([
            import("/app/chat/index.js"),
            import("/app/chat/outbox.js"),
        ]);
        const user = { id: "recovery-user", first_name: "Jules" };
        const chat = {
            id: "recovery-chat", display_name: "Recovery chat", membership_status: "accepted",
            role: "owner", accepted_count: 2, pending_count: 0, unread_count: 0,
            notification_level: "all", updated_at: new Date().toISOString(),
        };
        const requests = [];
        const api = {
            assetURL: (value) => value,
            getChats: async () => ({ items: [chat] }),
            getChat: async () => ({ chat, members: [] }),
            getChatMessages: async () => ({ items: [], next_before_sequence: null }),
            markChatRead: async () => ({}),
            sendChatMessage: async (_userId, chatId, payload) => {
                requests.push({ chatId, ...payload });
                if (fail) throw Object.assign(new Error("Temporarily offline"), { status: 503 });
                return {
                    id: "server-message", chat_id: chatId, room_sequence: 1,
                    sender_user_id: user.id, sender_first_name: user.first_name,
                    viewer_is_sender: true, kind: payload.daily_entry_id ? "memento" : "text", body: payload.body,
                    daily_entry_id: payload.daily_entry_id || null,
                    client_request_id: payload.client_request_id, status: "active",
                    created_at: new Date().toISOString(),
                };
            },
        };
        const root = document.createElement("div");
        root.id = "recovery-test-root";
        document.body.append(root);
        const view = createChatsView({
            root, api, getUser: () => user,
            getConfig: () => ({ enable_chats: true, enable_web_chats: true, enable_chat_daily_ledger: false, enable_web_mementos: false }),
            showToast: () => {},
        });
        await view.activate({});
        await view.openChat(chat.id, { updateHistory: false });
        if (fail) {
            root.querySelector("textarea").value = "Survive the reload";
            root.querySelector("form.chat-composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
        const waitFor = async (predicate, timeout = 5_000) => {
            const started = Date.now();
            while (!predicate()) {
                if (Date.now() - started > timeout) throw new Error("Timed out waiting for recovery state");
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
        };
        if (fail) await waitFor(() => root.querySelector(".chat-message.failed"));
        else await waitFor(() => requests.length === 1 && root.querySelector(".chat-message.sent"));
        const records = await outbox.listChatTextOutbox(user.id);
        return {
            requests,
            records,
            failedText: root.querySelector(".chat-message.failed")?.textContent || "",
            sentText: root.querySelector(".chat-message.sent")?.textContent || "",
        };
    }, shouldFail);
}

test("a failed chat text resumes after reload with the same idempotency key", async ({ page }) => {
    await page.goto("/app/?signin=1");
    await page.evaluate(async () => {
        const { clearChatTextOutbox } = await import("/app/chat/outbox.js");
        await clearChatTextOutbox("recovery-user");
    });
    const failed = await mountRecoveryChat(page, true);
    expect(failed.failedText).toContain("Survive the reload");
    expect(failed.records).toHaveLength(1);
    expect(failed.requests).toHaveLength(1);

    await page.reload();
    const recovered = await mountRecoveryChat(page, false);
    expect(recovered.sentText).toContain("Survive the reload");
    expect(recovered.records).toHaveLength(0);
    expect(recovered.requests).toHaveLength(1);
    expect(recovered.requests[0].client_request_id).toBe(failed.requests[0].client_request_id);
});

test("a staged Memento share resumes once with its text and authoritative entry ID", async ({ page }) => {
    await page.goto("/app/?signin=1");
    await page.evaluate(async () => {
        const outbox = await import("/app/chat/outbox.js");
        await outbox.clearChatTextOutbox("recovery-user");
        await outbox.putChatTextOutbox({
            userId: "recovery-user",
            chatId: "recovery-chat",
            clientRequestId: "stable-memento-reshare",
            body: "Recovered memory",
            dailyEntryId: "entry-authoritative",
        });
    });

    await page.reload();
    const recovered = await mountRecoveryChat(page, false);
    expect(recovered.sentText).toContain("Memento");
    expect(recovered.sentText).toContain("Recovered memory");
    expect(recovered.records).toHaveLength(0);
    expect(recovered.requests).toEqual([{
        chatId: "recovery-chat",
        body: "Recovered memory",
        daily_entry_id: "entry-authoritative",
        reply_to_message_id: null,
        client_request_id: "stable-memento-reshare",
    }]);
});
