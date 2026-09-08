import { expect, test } from "@playwright/test";

test("chat text outbox is user-scoped, bounded, and preserves idempotent retry data", async ({ page }) => {
    await page.goto("/app/?signin=1");
    const result = await page.evaluate(async () => {
        const outbox = await import("/app/chat/outbox.js");
        const userA = "outbox-user-a";
        const userB = "outbox-user-b";
        await outbox.clearChatTextOutbox(userA);
        await outbox.clearChatTextOutbox(userB);
        for (let index = 0; index < 55; index += 1) {
            await outbox.putChatTextOutbox({
                userId: userA,
                chatId: "chat-one",
                clientRequestId: `request-${String(index).padStart(2, "0")}`,
                body: `Message ${index}`,
                replyToMessageId: index === 54 ? "reply-target" : null,
            });
        }
        await outbox.putChatTextOutbox({
            userId: userB,
            chatId: "chat-two",
            clientRequestId: "request-b",
            body: "Private to B",
        });
        await outbox.putChatTextOutbox({
            userId: userB,
            chatId: "chat-two",
            clientRequestId: "memento-b",
            body: "",
            dailyEntryId: "entry-authoritative",
        });
        const beforeAttempt = await outbox.listChatTextOutbox(userA);
        const attempted = await outbox.markChatTextOutboxAttempt(userA, "request-54", 1_000);
        await outbox.removeChatTextOutbox(userA, "request-53");
        const afterRemove = await outbox.listChatTextOutbox(userA);
        const userBRecords = await outbox.listChatTextOutbox(userB);
        await outbox.clearChatTextOutbox(userA);
        await outbox.clearChatTextOutbox(userB);
        return {
            count: beforeAttempt.length,
            newest: beforeAttempt.at(-1),
            oldestRequest: beforeAttempt[0]?.client_request_id,
            attempted,
            afterRemoveCount: afterRemove.length,
            userBRecords,
            retryable: [
                outbox.chatTextSendIsRetryable({}),
                outbox.chatTextSendIsRetryable({ status: 503 }),
                outbox.chatTextSendIsRetryable({ status: 400 }),
            ],
        };
    });

    expect(result.count).toBe(50);
    expect(result.oldestRequest).toBe("request-05");
    expect(result.newest).toMatchObject({
        user_id: "outbox-user-a",
        chat_id: "chat-one",
        client_request_id: "request-54",
        body: "Message 54",
        reply_to_message_id: "reply-target",
    });
    expect(result.attempted).toMatchObject({ attempts: 1, next_attempt_at: 3_000 });
    expect(result.afterRemoveCount).toBe(49);
    expect(result.userBRecords).toHaveLength(2);
    expect(result.userBRecords[0].body).toBe("Private to B");
    expect(result.userBRecords[1]).toMatchObject({
        body: "",
        daily_entry_id: "entry-authoritative",
        client_request_id: "memento-b",
    });
    expect(result.retryable).toEqual([true, true, false]);
});

test("private media recovery is bounded, survives refresh, and clears all user chat data", async ({ page }) => {
    await page.goto("/app/?signin=1");
    await page.evaluate(async () => {
        const outbox = await import("/app/chat/outbox.js");
        await outbox.clearChatOutboxes("media-user-a");
        await outbox.clearChatOutboxes("media-user-b");
        for (let index = 0; index < 5; index += 1) {
            await outbox.putChatMediaOutbox({
                id: `media-user-a:chat-media:upload-${index}`,
                user_id: "media-user-a",
                kind: "chat_media",
                file: new File([`private-${index}`], `private-${index}.jpg`, { type: "image/jpeg" }),
                chat_id: "chat-private",
                content_type: "image/jpeg",
                view_once: index === 4,
                upload_request_id: `upload-${index}`,
                send_request_id: `send-${index}`,
            });
        }
        await outbox.putChatMediaOutbox({
            id: "media-user-b:memento:upload-b",
            user_id: "media-user-b",
            kind: "memento",
            file: new File(["private-b"], "private-b.jpg", { type: "image/jpeg" }),
            secondary: new File(["private-b-swapped"], "private-b-swapped.jpg", { type: "image/jpeg" }),
            chat_ids: ["chat-b"],
            request_id: "upload-b",
        });
        await outbox.putChatTextOutbox({
            userId: "media-user-a",
            chatId: "chat-private",
            clientRequestId: "text-a",
            body: "also private",
        });
    });

    await page.reload();
    const result = await page.evaluate(async () => {
        const outbox = await import("/app/chat/outbox.js");
        const userA = await outbox.listChatMediaOutbox("media-user-a");
        const userB = await outbox.listChatMediaOutbox("media-user-b");
        const attempted = await outbox.markChatMediaOutboxAttempt(userA[0].id, 10_000);
        const cacheURLs = (await Promise.all((await caches.keys()).map(async (name) => {
            const cache = await caches.open(name);
            return (await cache.keys()).map((request) => request.url);
        }))).flat();
        await outbox.clearChatOutboxes("media-user-a");
        const afterClear = {
            media: await outbox.listChatMediaOutbox("media-user-a"),
            text: await outbox.listChatTextOutbox("media-user-a"),
        };
        await outbox.clearChatOutboxes("media-user-b");
        return {
            userACount: userA.length,
            userBCount: userB.length,
            file: { size: userA[0].file.size, type: userA[0].file.type },
            secondary: { size: userB[0].secondary.size, type: userB[0].secondary.type, name: userB[0].secondary.name },
            attempted,
            privateCacheEntries: cacheURLs.filter((url) => url.includes("/api/") || url.startsWith("blob:")),
            afterClear,
        };
    });

    expect(result.userACount).toBe(3);
    expect(result.userBCount).toBe(1);
    expect(result.file).toEqual({ size: 9, type: "image/jpeg" });
    expect(result.secondary).toEqual({ size: 17, type: "image/jpeg", name: "private-b-swapped.jpg" });
    expect(result.attempted).toMatchObject({ attempts: 1, next_attempt_at: 14_000 });
    expect(result.privateCacheEntries).toEqual([]);
    expect(result.afterClear).toEqual({ media: [], text: [] });
});

test("a saved media upload resumes idempotently when the app is reopened", async ({ page }) => {
    await page.goto("/app/?signin=1");
    await page.evaluate(async () => {
        const outbox = await import("/app/chat/outbox.js");
        await outbox.clearChatOutboxes("demo-user");
        await outbox.putChatMediaOutbox({
            id: "demo-user:chat-media:reopen-upload",
            user_id: "demo-user",
            kind: "chat_media",
            file: new File(["reopen-photo"], "reopen.jpg", { type: "image/jpeg" }),
            thumbnail: null,
            chat_id: "chat-noah",
            content_type: "image/jpeg",
            duration_ms: null,
            view_once: false,
            overlay: null,
            reply_to_message_id: null,
            upload_request_id: "reopen-upload",
            send_request_id: "reopen-send",
        });
    });

    await page.goto("/app/?demo=1&signin=1&tab=chats&chat=chat-noah");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.locator(".chat-room-title")).toContainText("Noah Williams");
    await expect(page.getByRole("button", { name: "Photo", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
        const outbox = await import("/app/chat/outbox.js");
        return (await outbox.listChatMediaOutbox("demo-user")).length;
    })).toBe(0);
});

test("a Memento recovery expires instead of publishing on a later day", async ({ page }) => {
    await page.goto("/app/?signin=1");
    await page.evaluate(async () => {
        const outbox = await import("/app/chat/outbox.js");
        await outbox.clearChatOutboxes("demo-user");
        await outbox.putChatMediaOutbox({
            id: "demo-user:memento:expired-upload",
            user_id: "demo-user",
            kind: "memento",
            file: new File(["expired-memento"], "expired.jpg", { type: "image/jpeg" }),
            chat_ids: ["chat-noah"],
            caption: "Yesterday",
            ledger_date: "2000-01-01",
            request_id: "expired-upload",
        });
    });

    await page.goto("/app/?demo=1&signin=1&tab=chats&chat=chat-noah");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByText("An unsent Memento expired at the end of its day.", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
        const outbox = await import("/app/chat/outbox.js");
        return (await outbox.listChatMediaOutbox("demo-user")).length;
    })).toBe(0);
});
