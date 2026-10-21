// All relationship decisions come from the server. Never infer a block reason
// or an anonymous identity from an unavailable account.
export function relationshipFor(person, { friends = [], incoming = [], outgoing = [] } = {}) {
    const id = String(person.user_id);
    if (person.blocked_by_viewer) return "blocked";
    if (person.can_add === false) return "unavailable";
    if (incoming.some((item) => String(item.user_id) === id)) return "added_you";
    if (outgoing.some((item) => String(item.user_id) === id)) return "requested";
    if (friends.some((item) => String(item.user_id) === id)) return "added";
    return person.relation || "none";
}

export function parseAddLink(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.hostname !== "validapp.lol" || url.port || url.username || url.password) return null;
        const match = /^\/add\/([A-Za-z0-9_\.]{1,64})\/?$/.exec(url.pathname);
        return match?.[1] || null;
    } catch { return null; }
}

export function suggestionDescription(person) {
    const count = Math.max(0, Number(person.mutual_count) || 0);
    const reason = person.reason === "mutual" ? "" : person.reason_label || (person.label || "").replace(/\s*·\s*\d+ mutual.*$/i, "");
    return [reason, count ? `${count} mutual friend${count === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
}
