// Vault routes (six7 app/api/vault.py + vault_pin.py, docs/vault.md), kept out
// of the startup api.js. The unlock token is sent only for private items and
// is never stored. The localhost demo answers through DemoAPI.demoVault.
const unlock = (token) => (token ? { headers: { "X-Vault-Unlock": token } } : {});
const post = (body) => ({ method: "POST", body: JSON.stringify(body) });

const ROUTES = {
    list: (userId, { scope = "memories", cursor = null, limit = 36, unlockToken = null } = {}) => {
        const params = new URLSearchParams({ scope, limit: String(limit) });
        if (cursor) params.set("cursor", cursor);
        return [`/users/${userId}/vault?${params}`, unlock(unlockToken)];
    },
    privacy: (userId, itemId, makePrivate, unlockToken = null) => [`/users/${userId}/vault/${itemId}/privacy`, { ...unlock(unlockToken), ...post({ private: makePrivate }) }],
    delete: (userId, itemId, unlockToken = null) => [`/users/${userId}/vault/${itemId}`, { ...unlock(unlockToken), method: "DELETE" }],
    status: (userId) => [`/users/${userId}/vault/pin`, {}],
    setPin: (userId, pin, currentPin = null) => [`/users/${userId}/vault/pin`, { method: "PUT", body: JSON.stringify({ pin, current_pin: currentPin }) }],
    unlock: (userId, pin) => [`/users/${userId}/vault/unlock`, post({ pin })],
    removePin: (userId, pin) => [`/users/${userId}/vault/pin/remove`, post({ pin })],
    resetPin: (userId) => [`/users/${userId}/vault/pin/reset`, { method: "POST" }],
};

export function vaultClient(api) {
    const call = (action, ...args) => (typeof api.demoVault === "function"
        ? api.demoVault(action, ...args)
        : api.request(...ROUTES[action](...args)));
    return {
        getVault: (...args) => call("list", ...args),
        setVaultItemPrivacy: (...args) => call("privacy", ...args),
        deleteVaultItem: (...args) => call("delete", ...args),
        getVaultPinStatus: (...args) => call("status", ...args),
        setVaultPin: (...args) => call("setPin", ...args),
        unlockVault: (...args) => call("unlock", ...args),
        removeVaultPin: (...args) => call("removePin", ...args),
        resetVaultPin: (...args) => call("resetPin", ...args),
    };
}
