import { expect, test } from "@playwright/test";

test("named chat SSE events trigger bounded authoritative reconnect repair", async ({ page }) => {
    await page.goto("/app/?signin=1");
    const result = await page.evaluate(async () => {
        const originalEventSource = window.EventSource;
        class FakeEventSource {
            static CLOSED = 2;
            static instance = null;
            constructor(url) {
                this.url = url;
                this.readyState = 1;
                this.listeners = {};
                FakeEventSource.instance = this;
            }
            addEventListener(type, callback) { this.listeners[type] = callback; }
            emit(type, payload, lastEventId = "") {
                this.listeners[type]?.({ data: JSON.stringify(payload), lastEventId });
            }
        }
        window.EventSource = FakeEventSource;
        try {
            const { createChatsView } = await import("/app/chat/index.js");
            const calls = [];
            const chat = { id: "realtime-chat", display_name: "Realtime", membership_status: "accepted", accepted_count: 2, unread_count: 0, notification_level: "all" };
            const messages = [{ id: "message-3", chat_id: chat.id, room_sequence: 3, sender_user_id: "peer", body: "Before reconnect", kind: "text", status: "active", created_at: new Date().toISOString() }];
            const api = {
                assetURL: (value) => value,
                chatEventsURL: () => "/chat-events",
                getChats: async () => ({ items: [chat] }),
                getChat: async () => ({ chat, members: [] }),
                getChatMessages: async (_userId, _chatId, options) => { calls.push(options); return { items: messages, next_before_sequence: null }; },
                markChatRead: async () => ({}),
            };
            const root = document.createElement("div");
            document.body.append(root);
            const view = createChatsView({
                root, api, getUser: () => ({ id: "realtime-user", first_name: "Jules" }),
                getConfig: () => ({ enable_chats: true, enable_web_chats: true, enable_chat_daily_ledger: false, enable_web_mementos: false }),
            });
            await view.activate({});
            await view.openChat(chat.id, { updateHistory: false });
            calls.length = 0;
            FakeEventSource.instance.emit("chat", { type: "ready", chat_id: chat.id }, "cursor-ready");
            while (calls.length < 1) await new Promise((resolve) => setTimeout(resolve, 10));
            FakeEventSource.instance.emit("chat", { id: "event-4", type: "message_created", chat_id: chat.id });
            while (calls.length < 2) await new Promise((resolve) => setTimeout(resolve, 10));
            return {
                hasNamedListener: typeof FakeEventSource.instance.listeners.chat === "function",
                readyOptions: calls[0],
                incrementalOptions: calls[1],
                lastEventId: view.store.state.lastEventId,
            };
        } finally {
            window.EventSource = originalEventSource;
        }
    });

    expect(result.hasNamedListener).toBe(true);
    expect(result.readyOptions).toMatchObject({ limit: 100, afterSequence: null });
    expect(result.incrementalOptions).toMatchObject({ limit: 100, afterSequence: 3 });
    expect(result.lastEventId).toBe("event-4");
});

