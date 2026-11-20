// Whether today's Memento is still due (MementoDayStatus): the Camera tab's
// red dot and whether the tab opens the Memento camera or the everyday one.
// It reads the last chat list this device saw plus the chats it sent today's
// Memento to; nothing here waits on the network.

const postedKey = (userId) => `valid.mementoPosted.${userId}`;

export function localLedgerDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readPosted(userId) {
    try {
        const saved = JSON.parse(localStorage.getItem(postedKey(userId)) || "null");
        if (saved?.date === localLedgerDate() && Array.isArray(saved.chatIds)) return new Set(saved.chatIds.map(String));
    } catch (_) { /* private mode */ }
    return new Set();
}

// MementoDayStatus.takesMementos.
export function chatTakesMementos(chat) {
    return chat?.status === "active"
        && (chat.membership_status || "accepted") === "accepted"
        && Number(chat.accepted_count || 0) >= 2
        && chat.is_memento_eligible_today !== false;
}

export function createMementoDay() {
    let userId = null;
    let chats = null;
    let listDate = null;
    let posted = new Set();
    const listeners = new Set();
    const notify = () => listeners.forEach((listener) => listener());

    return {
        setUser(id) {
            if (String(id || "") === String(userId || "")) return;
            userId = id ? String(id) : null;
            chats = null;
            listDate = null;
            posted = userId ? readPosted(userId) : new Set();
            notify();
        },
        // The chat list as last loaded (up to the first page is enough).
        setChats(items) {
            chats = Array.isArray(items) ? items : null;
            listDate = localLedgerDate();
            notify();
        },
        // MementoDayStatus.sendStarted: the dot clears the moment Send is tapped.
        sendStarted(chatIds) {
            if (!userId) return;
            if (listDate !== localLedgerDate()) posted = readPosted(userId);
            for (const chatId of chatIds) posted.add(String(chatId));
            try { localStorage.setItem(postedKey(userId), JSON.stringify({ date: localLedgerDate(), chatIds: [...posted] })); } catch (_) { /* private mode */ }
            notify();
        },
        postedChatIds() {
            posted = userId ? readPosted(userId) : new Set();
            return new Set(posted);
        },
        // null until a chat list has been read, so the dot never flashes at launch.
        status() {
            if (!userId || !chats) return null;
            const today = localLedgerDate();
            const fresh = listDate === today;
            const postedToday = userId ? readPosted(userId) : new Set();
            const openChats = chats.filter((chat) => chatTakesMementos(chat)
                && !postedToday.has(String(chat.id))
                && !(fresh && chat.has_posted_today_memento));
            return { isDue: openChats.length > 0, openChats };
        },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
}

// CameraTabItem accessibility hint.
export function cameraTabHint(status) {
    if (!status?.isDue) return "Take a photo or video and choose who gets it";
    const count = status.openChats?.length;
    if (!Number.isFinite(count)) return "Today's Memento isn't sent yet";
    return count === 1 ? "1 chat is still waiting for today's Memento" : `${count} chats are still waiting for today's Memento`;
}
