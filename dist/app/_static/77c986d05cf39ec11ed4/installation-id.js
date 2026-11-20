// One random id per browser installation. Sign-up sends it raw as
// deviceInstallationId (the server stores its SHA-256 as the registered device
// hash), and every API request sends the same SHA-256 as X-Client-Instance-ID,
// exactly as the iOS app does. Never log either value.
const STORAGE_KEY = "valid.web.installation-id";
export const CLIENT_INSTANCE_HEADER = "X-Client-Instance-ID";
const FIRST_HASH_WAIT_MS = 100;

export function deviceInstallationId() {
    let value = localStorage.getItem(STORAGE_KEY);
    if (!value) {
        value = crypto.randomUUID();
        localStorage.setItem(STORAGE_KEY, value);
    }
    return value;
}

async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Computed once per id; `value` stays undefined until the digest settles.
let cached = null;

function hashEntry() {
    try {
        if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function") return null;
        const id = deviceInstallationId();
        if (cached?.id === id) return cached;
        const entry = { id, value: undefined, promise: null };
        entry.promise = sha256Hex(id).then(
            (hash) => (entry.value = /^[a-f0-9]{64}$/.test(hash) ? hash : null),
            () => (entry.value = null),
        );
        cached = entry;
        return entry;
    } catch (_) {
        // Storage blocked, no secure context or no WebCrypto: send no header.
        return null;
    }
}

// The cached hash without waiting: a string, null when it cannot be computed,
// or undefined while the first digest is still running (it is started here).
export function readyClientInstanceHash() {
    const entry = hashEntry();
    return entry ? entry.value : null;
}

// The lowercase hex SHA-256 of deviceInstallationId(), or null when it cannot
// be computed. Never rejects, and waits at most FIRST_HASH_WAIT_MS for the
// first digest; after that the cached value is returned without waiting.
export async function clientInstanceHash({ waitMs = FIRST_HASH_WAIT_MS } = {}) {
    const entry = hashEntry();
    if (!entry) return null;
    if (entry.value !== undefined) return entry.value;
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, waitMs, null); });
    try {
        return await Promise.race([entry.promise, timeout]);
    } catch (_) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}
