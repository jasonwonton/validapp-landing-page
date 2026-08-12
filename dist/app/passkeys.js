function normalizeBase64(value) {
    const standard = value.replace(/-/g, "+").replace(/_/g, "/");
    return standard + "=".repeat((4 - (standard.length % 4)) % 4);
}

function base64ToBytes(value) {
    const binary = atob(normalizeBase64(value));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(value) {
    if (!value) return null;
    const bytes = new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

export function passkeysSupported() {
    return Boolean(window.PublicKeyCredential && navigator.credentials);
}

async function createRegistrationCredential(options) {
    let credential;
    try {
        credential = await navigator.credentials.create({
            publicKey: {
                challenge: base64ToBytes(options.challenge),
                rp: { id: options.rpId, name: options.rpName },
                user: {
                    id: new TextEncoder().encode(options.userId),
                    name: options.userName,
                    displayName: options.userName,
                },
                pubKeyCredParams: [
                    { type: "public-key", alg: -7 },
                    { type: "public-key", alg: -257 },
                ],
                authenticatorSelection: {
                    residentKey: "required",
                    requireResidentKey: true,
                    userVerification: "required",
                },
                timeout: 60_000,
                attestation: "none",
            },
        });
    } catch (error) {
        if (error?.name === "NotAllowedError") throw new Error("Passkey setup was canceled.");
        if (error?.name === "SecurityError") throw new Error("Passkey setup is not enabled for this domain yet.");
        throw error;
    }
    if (!credential?.response) throw new Error("The browser did not create a passkey.");
    return {
        userId: options.userId,
        credentialId: bytesToBase64(credential.rawId),
        publicKey: bytesToBase64(credential.response.getPublicKey?.()) || "",
        attestationObject: bytesToBase64(credential.response.attestationObject),
        clientDataJSON: bytesToBase64(credential.response.clientDataJSON),
    };
}

export async function signInWithPasskey(api) {
    if (!passkeysSupported()) {
        throw new Error("This browser does not support passkeys. Try Chrome or Safari on a recent device.");
    }

    const challenge = await api.getPasskeyChallenge();
    const allowCredentials = challenge.allowCredentials?.map((credentialId) => ({
        id: base64ToBytes(credentialId),
        type: "public-key",
        transports: ["internal", "hybrid"],
    }));

    let credential;
    try {
        credential = await navigator.credentials.get({
            publicKey: {
                challenge: base64ToBytes(challenge.challenge),
                rpId: challenge.rpId,
                allowCredentials: allowCredentials || [],
                timeout: challenge.timeout || 60_000,
                userVerification: "required",
            },
        });
    } catch (error) {
        if (error?.name === "NotAllowedError") {
            throw new Error("Passkey sign-in was canceled or no matching passkey was available.");
        }
        if (error?.name === "SecurityError") {
            const localLoopback = ["127.0.0.1", "localhost"].includes(window.location.hostname);
            if (localLoopback) {
                throw new Error("Valid passkeys belong to six7.lol and cannot be used from 127.0.0.1. Open https://six7.lol:8443/app/ on your phone.");
            }
            throw new Error("Passkey access is not enabled for this domain yet.");
        }
        throw error;
    }

    if (!credential?.response) {
        throw new Error("The browser did not return a passkey response.");
    }

    return api.authenticatePasskey({
        credentialId: bytesToBase64(credential.rawId),
        authenticatorData: bytesToBase64(credential.response.authenticatorData),
        signature: bytesToBase64(credential.response.signature),
        clientDataJSON: bytesToBase64(credential.response.clientDataJSON),
        userHandle: bytesToBase64(credential.response.userHandle),
        correlationId: challenge.correlationId || null,
    });
}

export async function createSignupPasskey(api, username) {
    if (!passkeysSupported()) {
        throw new Error("This browser does not support passkeys. Try current Chrome, Safari, or Edge.");
    }
    const options = await api.getWebSignupChallenge(username);
    return createRegistrationCredential(options);
}

export async function createAdditionalPasskey(api, userId) {
    if (!passkeysSupported()) {
        throw new Error("This browser does not support passkeys. Try current Chrome, Safari, or Edge.");
    }
    const options = await api.getPasskeyRegistrationChallenge(userId);
    const registration = await createRegistrationCredential(options);
    await api.registerPasskey(registration);
    return registration;
}
