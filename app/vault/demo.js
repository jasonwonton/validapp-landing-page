// Localhost demo fixtures for Memories and the Vault. Mirrors the server rules
// in six7 app/api/vault.py + vault_pin.py (docs/vault.md): scopes, cursors,
// unlock tokens, five-guess lockouts, and the 15-minute "forgot PIN" window.
//
// Query switches: vault=0 (flag off), vaultpin=1 (PIN 1234 already set, with
// three items in the Vault), vaultempty=1, vaultexpired=1 (the first page has
// expired signed URLs), vaultreset=old (the session is too old to reset).
import { APIError } from "../api.js";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60_000;
const TOKEN_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

const PALETTES = [
    ["#ff9a8b", "#ff6a88", "#ffd3a5"], ["#89f7fe", "#66a6ff", "#e0f7ff"], ["#fddb92", "#d1fdff", "#fff6d5"],
    ["#a1c4fd", "#c2e9fb", "#f0f8ff"], ["#f6d365", "#fda085", "#fff1dc"], ["#84fab0", "#8fd3f4", "#e8fff3"],
    ["#fbc2eb", "#a6c1ee", "#fdf0ff"], ["#43e97b", "#38f9d7", "#e9fff6"], ["#fa709a", "#fee140", "#fff2e0"],
    ["#30cfd0", "#330867", "#d7f7ff"],
];
// Simple drawn subjects (no emoji: tests/interface-assets.spec.js scans app/).
const MOTIFS = [
    '<circle cx="300" cy="440" r="90" fill="#ff8a3d"/><path d="M210 440h180M300 350v180M236 376q64 64 0 128M364 376q-64 64 0 128" stroke="#5b2a0c" stroke-width="7" fill="none"/>',
    '<path d="M300 330l33 70 77 9-57 52 16 76-69-39-69 39 16-76-57-52 77-9z" fill="#fff6a8"/>',
    '<path d="M300 540c-90-60-140-110-140-160a70 70 0 0 1 140-20 70 70 0 0 1 140 20c0 50-50 100-140 160z" fill="#ff5c8a"/>',
    '<path d="M300 320l100 170H200z" fill="#1f7a4d"/><path d="M300 380l80 150H220z" fill="#23915a"/><rect x="286" y="530" width="28" height="40" fill="#6b3f1d"/>',
    '<rect x="190" y="400" width="60" height="170" fill="#2b3a55"/><rect x="260" y="340" width="80" height="230" fill="#34466b"/><rect x="350" y="420" width="60" height="150" fill="#2b3a55"/><path d="M280 370h40M280 410h40M280 450h40M280 490h40" stroke="#ffd66b" stroke-width="10"/>',
    '<g fill="#fff"><circle cx="300" cy="380" r="42"/><circle cx="358" cy="440" r="42"/><circle cx="300" cy="500" r="42"/><circle cx="242" cy="440" r="42"/></g><circle cx="300" cy="440" r="34" fill="#ffc83d"/>',
    '<circle cx="290" cy="440" r="95" fill="#fff4c9"/><circle cx="335" cy="405" r="82" fill="url(#g)"/>',
    '<path d="M270 360l110-26v150" stroke="#1d1d3b" stroke-width="16" fill="none"/><ellipse cx="250" cy="520" rx="34" ry="26" fill="#1d1d3b"/><ellipse cx="360" cy="490" rx="34" ry="26" fill="#1d1d3b"/>',
];
const CAPTIONS = ["best day ever", "homecoming", "beach crew", "finally friday", "study grind", "road trip!"];

function art(index) {
    const [from, to, glow] = PALETTES[index % PALETTES.length];
    const sunX = 120 + ((index * 97) % 360);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
<rect width="600" height="800" fill="url(#g)"/><circle cx="${sunX}" cy="210" r="96" fill="${glow}" opacity=".75"/>
<path d="M0 600 Q150 ${520 + (index % 4) * 20} 300 590 T600 560 V800 H0Z" fill="#000" opacity=".16"/>
<path d="M0 680 Q200 ${620 + (index % 3) * 25} 400 690 T600 670 V800 H0Z" fill="#000" opacity=".22"/>
${MOTIFS[index % MOTIFS.length]}
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function fixtures(params) {
    const now = Date.now();
    const count = params.get("vaultempty") === "1" ? 0 : 44;
    const items = [];
    for (let index = 0; index < count; index += 1) {
        const video = index % 5 === 2;
        const story = index % 4 === 1;
        const capturedAt = new Date(now - Math.round(index * 2.7 * DAY_MS) - (index % 7) * 3_600_000);
        items.push({
            id: `vault-demo-${String(index + 1).padStart(3, "0")}`,
            source: story ? "story" : "capture",
            story_id: story ? `story-demo-${index}` : null,
            media_type: video ? "video" : "photo",
            media_url: video ? "../assets/demo.mp4" : art(index),
            thumbnail_url: video ? art(index) : null,
            video_duration_ms: video ? 4_000 + (index % 4) * 3_500 : null,
            text_overlays: index % 6 === 3 ? [{ text: CAPTIONS[index % CAPTIONS.length], x: 0.5, y: 0.72 }] : null,
            captured_at: capturedAt.toISOString(),
            is_private: false,
            deleted: false,
        });
    }
    if (params.get("vaultpin") === "1") {
        [0.3, 4.2, 40].forEach((daysAgo, index) => items.push({
            id: `vault-demo-private-${index + 1}`,
            source: "capture", story_id: null, media_type: "photo", media_url: art(index + 6),
            thumbnail_url: null, video_duration_ms: null, text_overlays: null,
            captured_at: new Date(now - daysAgo * DAY_MS).toISOString(), is_private: true, deleted: false,
        }));
    }
    return items;
}

function state(api) {
    if (api.vaultDemoState) return api.vaultDemoState;
    const params = new URLSearchParams(location.search);
    api.vaultDemoState = {
        items: fixtures(params),
        pin: params.get("vaultpin") === "1" ? "1234" : null,
        pinVersion: 1,
        failed: 0,
        lockouts: 0,
        lockedUntil: 0,
        tokens: new Map(),
        signedInAt: params.get("vaultreset") === "old" ? Date.now() - 60 * 60_000 : Date.now(),
        expireFirstPage: params.get("vaultexpired") === "1",
    };
    return api.vaultDemoState;
}

function fail(status, code, message, extra = {}) {
    return new APIError(message, status, { code, message, ...extra });
}

function pinStatus(st) {
    const locked = st.lockedUntil > Date.now();
    return {
        has_pin: Boolean(st.pin),
        locked_until: locked ? new Date(st.lockedUntil).toISOString() : null,
        remaining_attempts: !st.pin ? MAX_ATTEMPTS : locked ? 0 : MAX_ATTEMPTS - st.failed,
    };
}

function issueToken(st) {
    const token = `demo-unlock.${st.pinVersion}.${Math.random().toString(36).slice(2)}`;
    const expires = Date.now() + TOKEN_MS;
    st.tokens.set(token, { version: st.pinVersion, expires });
    return { unlock_token: token, expires_at: new Date(expires).toISOString() };
}

function tokenValid(st, token) {
    const record = token ? st.tokens.get(token) : null;
    return Boolean(st.pin && record && record.version === st.pinVersion && record.expires > Date.now());
}

function attempt(st, pin) {
    if (!st.pin) throw fail(409, "vault_pin_not_set", "No Vault PIN is set.");
    const lockedUntil = () => new Date(st.lockedUntil).toISOString();
    if (st.lockedUntil > Date.now()) throw fail(429, "vault_pin_locked", "Too many incorrect PINs. Try again later.", { locked_until: lockedUntil() });
    if (pin === st.pin) {
        st.failed = 0;
        return;
    }
    st.failed += 1;
    if (st.failed >= MAX_ATTEMPTS) {
        st.lockedUntil = Date.now() + Math.min(24 * 60 * 60_000, LOCKOUT_MS * 2 ** st.lockouts);
        st.lockouts += 1;
        st.failed = 0;
        throw fail(429, "vault_pin_locked", "Too many incorrect PINs. Try again later.", { locked_until: lockedUntil() });
    }
    throw fail(403, "vault_pin_incorrect", "Incorrect PIN.", { remaining_attempts: MAX_ATTEMPTS - st.failed });
}

function newPin(st, pin) {
    st.pin = pin;
    st.pinVersion += 1;
    st.failed = 0;
    st.tokens.clear();
    return issueToken(st);
}

function publicItem(item, expired = false) {
    const { deleted: _deleted, ...copy } = structuredClone(item);
    if (expired) {
        copy.media_url = "../assets/vault-demo-expired.jpg?X-Amz-Signature=expired";
        if (copy.thumbnail_url) copy.thumbnail_url = "../assets/vault-demo-expired.jpg?X-Amz-Signature=expired-thumb";
    }
    return copy;
}

function find(st, itemId) {
    const item = st.items.find((entry) => entry.id === itemId && !entry.deleted);
    if (!item) throw fail(404, "vault_item_not_found", "That's no longer available.");
    return item;
}

const actions = {
    list(st, [_userId, { scope = "memories", cursor = null, limit = 36, unlockToken = null } = {}]) {
        const isPrivate = scope === "private";
        if (isPrivate && !st.pin) return { items: [], next_cursor: null, total_count: 0 };
        if (isPrivate && !tokenValid(st, unlockToken)) throw fail(403, "vault_locked", "Unlock your Vault to see this.");
        const live = st.items
            .filter((item) => !item.deleted && item.is_private === isPrivate)
            .sort((a, b) => b.captured_at.localeCompare(a.captured_at) || b.id.localeCompare(a.id));
        const start = Number(cursor || 0);
        const size = Math.min(100, Math.max(1, Number(limit) || 36));
        const expired = !isPrivate && st.expireFirstPage && !cursor;
        if (expired) st.expireFirstPage = false;
        const page = live.slice(start, start + size).map((item, index) => publicItem(item, expired && index < 6));
        return {
            items: page,
            next_cursor: start + size < live.length ? String(start + size) : null,
            total_count: live.length,
        };
    },
    privacy(st, [_userId, itemId, makePrivate, unlockToken]) {
        const item = find(st, itemId);
        if ((item.is_private || !makePrivate) && !tokenValid(st, unlockToken)) {
            throw fail(403, "vault_locked", "Unlock your Vault to do that.");
        }
        if (makePrivate && !st.pin) throw fail(409, "vault_pin_not_set", "Set a Vault PIN first.");
        item.is_private = Boolean(makePrivate);
        return publicItem(item);
    },
    delete(st, [_userId, itemId, unlockToken]) {
        const item = st.items.find((entry) => entry.id === itemId);
        if (!item || item.deleted) return null;
        if (item.is_private && !tokenValid(st, unlockToken)) throw fail(403, "vault_locked", "Unlock your Vault to do that.");
        item.deleted = true;
        return null;
    },
    status(st) {
        return pinStatus(st);
    },
    setPin(st, [_userId, pin, currentPin]) {
        if (!/^[0-9]{4}$/.test(String(pin))) throw fail(422, "invalid_pin", "A Vault PIN is exactly 4 digits.");
        if (!st.pin) return newPin(st, pin);
        if (!currentPin) {
            if (st.lockedUntil > Date.now()) attempt(st, null);
            throw fail(403, "vault_pin_incorrect", "Enter your current PIN to change it.", { remaining_attempts: MAX_ATTEMPTS - st.failed });
        }
        attempt(st, currentPin);
        st.lockouts = 0;
        return newPin(st, pin);
    },
    unlock(st, [_userId, pin]) {
        attempt(st, pin);
        return issueToken(st);
    },
    removePin(st, [_userId, pin]) {
        if (!st.pin) return null;
        attempt(st, pin);
        st.pin = null;
        st.lockouts = 0;
        st.tokens.clear();
        for (const item of st.items) item.is_private = false;
        return null;
    },
    resetPin(st) {
        if (Date.now() - st.signedInAt > 15 * 60_000) {
            throw fail(403, "vault_pin_reset_requires_recent_sign_in", "Sign in again with your phone number to reset your Vault PIN.");
        }
        st.pin = null;
        st.lockouts = 0;
        st.failed = 0;
        st.lockedUntil = 0;
        st.tokens.clear();
        return null;
    },
};

export async function demoVault(api, action, args) {
    const handler = actions[action];
    if (!handler) throw new Error(`Unknown demo Vault action: ${action}`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    return handler(state(api), args);
}
