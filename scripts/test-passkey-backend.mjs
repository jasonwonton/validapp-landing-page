import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const six7Root = path.resolve(process.env.SIX7_REPO || path.join(repoRoot, "..", "six7"));
const python = process.env.SIX7_PYTHON || path.join(six7Root, ".venv", "bin", "python");
const backendPort = 8765;
const tlsPort = 8443;
const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "valid-passkey-e2e-"));
const certificatePath = path.join(temporaryDirectory, "certificate.pem");
const keyPath = path.join(temporaryDirectory, "key.pem");

let backend;
let browser;
let tlsServer;
let backendOutput = "";

function backendRequest(req, res) {
    const proxy = http.request({
        hostname: "127.0.0.1",
        port: backendPort,
        path: req.url,
        method: req.method,
        headers: {
            ...req.headers,
            host: `127.0.0.1:${backendPort}`,
            connection: "close",
        },
    }, (upstream) => {
        res.writeHead(upstream.statusCode || 502, upstream.headers);
        upstream.pipe(res);
    });
    proxy.on("error", (error) => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: `Integration backend unavailable: ${error.message}` }));
    });
    req.pipe(proxy);
}

function createTlsServer() {
    const passkeyModule = readFileSync(path.join(repoRoot, "app", "passkeys.js"));
    return https.createServer(
        { cert: readFileSync(certificatePath), key: readFileSync(keyPath) },
        (req, res) => {
            const hostname = (req.headers.host || "").split(":")[0];
            if (hostname === "six7.lol" && req.url === "/.well-known/webauthn") {
                res.writeHead(200, {
                    "content-type": "application/json",
                    "cache-control": "no-store",
                });
                res.end(JSON.stringify({ origins: ["https://validapp.lol"] }));
                return;
            }
            if (hostname !== "validapp.lol") {
                res.writeHead(404);
                res.end("Unknown integration-test host");
                return;
            }
            if (req.url?.startsWith("/api/v1/")) {
                backendRequest(req, res);
                return;
            }
            if (req.url === "/app/passkeys.js") {
                res.writeHead(200, {
                    "content-type": "text/javascript; charset=utf-8",
                    "cache-control": "no-store",
                });
                res.end(passkeyModule);
                return;
            }
            if (req.url === "/test") {
                res.writeHead(200, {
                    "content-type": "text/html; charset=utf-8",
                    "cache-control": "no-store",
                });
                res.end("<!doctype html><title>Valid passkey integration</title><main>ready</main>");
                return;
            }
            res.writeHead(404);
            res.end("Not found");
        },
    );
}

async function listen(server, port) {
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
    });
}

async function waitForBackend() {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        const ready = await new Promise((resolve) => {
            const request = http.get(
                { hostname: "127.0.0.1", port: backendPort, path: "/health" },
                (response) => {
                    response.resume();
                    resolve(response.statusCode === 200);
                },
            );
            request.on("error", () => resolve(false));
        });
        if (ready) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Backend harness did not become healthy.\n${backendOutput}`);
}

async function runBrowserJourney(page) {
    return page.evaluate(async () => {
        const { createSignupPasskey, signInWithPasskey } = await import("/app/passkeys.js");

        async function request(pathname, options = {}) {
            const response = await fetch(`/api/v1${pathname}`, {
                ...options,
                headers: {
                    accept: "application/json",
                    ...(options.body ? { "content-type": "application/json" } : {}),
                    ...(options.headers || {}),
                },
            });
            const responseText = response.status === 204 ? "" : await response.text();
            let body = null;
            if (responseText) {
                try {
                    body = JSON.parse(responseText);
                } catch {
                    throw new Error(`${pathname} returned HTTP ${response.status}: ${responseText}`);
                }
            }
            if (!response.ok) {
                const error = new Error(body?.detail || `HTTP ${response.status}`);
                error.status = response.status;
                throw error;
            }
            return body;
        }

        let lastAuthenticationPayload = null;
        const api = {
            getWebSignupChallenge(username) {
                return request("/auth/passkey/signup/challenge", {
                    method: "POST",
                    body: JSON.stringify({ username }),
                });
            },
            getPasskeyChallenge() {
                return request("/auth/passkey/authenticate/challenge");
            },
            authenticatePasskey(payload) {
                lastAuthenticationPayload = payload;
                return request("/auth/passkey/authenticate", {
                    method: "POST",
                    body: JSON.stringify(payload),
                });
            },
        };

        const username = `web_e2e_${Date.now()}`;
        const registration = await createSignupPasskey(api, username);
        const signupPayload = {
            ...registration,
            deviceInstallationId: "browser-integration-device",
            idempotencyKey: `browser-integration-${Date.now()}`,
            profile: {
                first_name: "Taylor",
                last_name: "Jordan",
                date_of_birth: "2008-05-12T00:00:00Z",
                gender: "non-binary",
                school_id: 7,
                grade: "Senior",
                username,
                profile_picture_filename: null,
            },
        };
        const signup = await request("/auth/passkey/signup/complete", {
            method: "POST",
            body: JSON.stringify(signupPayload),
        });
        let registrationReplayStatus = null;
        try {
            await request("/auth/passkey/signup/complete", {
                method: "POST",
                body: JSON.stringify(signupPayload),
            });
        } catch (error) {
            registrationReplayStatus = error.status;
        }
        let smsRouteStatus = null;
        try {
            await request("/auth/phone/request", {
                method: "POST",
                body: JSON.stringify({
                    phone_number: "5551234567",
                    channel: "sms",
                    device_installation_id: "browser-integration-device",
                }),
            });
        } catch (error) {
            smsRouteStatus = error.status;
        }

        const authHeader = (token) => ({ authorization: `Bearer ${token}` });
        const signupProfile = await request(`/users/${signup.user.id}/profile`, {
            headers: authHeader(signup.access_token),
        });
        const passkeyStatus = await request("/auth/passkey/status", {
            headers: authHeader(signup.access_token),
        });

        await request("/auth/logout", {
            method: "POST",
            headers: authHeader(signup.access_token),
        });
        let revokedStatus = null;
        try {
            await request(`/users/${signup.user.id}/profile`, {
                headers: authHeader(signup.access_token),
            });
        } catch (error) {
            revokedStatus = error.status;
        }

        const login = await signInWithPasskey(api);
        const loginProfile = await request(`/users/${login.user.id}/profile`, {
            headers: authHeader(login.access_token),
        });
        let authenticationReplayStatus = null;
        try {
            await request("/auth/passkey/authenticate", {
                method: "POST",
                body: JSON.stringify(lastAuthenticationPayload),
            });
        } catch (error) {
            authenticationReplayStatus = error.status;
        }

        return {
            signupUserId: signup.user.id,
            loginUserId: login.user.id,
            username,
            signupProfileUsername: signupProfile.username,
            loginProfileUsername: loginProfile.username,
            passkeyRegistered: passkeyStatus.registered,
            credentialCount: passkeyStatus.credentialCount,
            revokedStatus,
            registrationReplayStatus,
            authenticationReplayStatus,
            smsRouteStatus,
            tokenRotated: signup.access_token !== login.access_token,
            signupPhoneVerification: signup.phone_verification,
            loginPhoneVerification: login.phone_verification,
        };
    });
}

try {
    execFileSync("openssl", [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=validapp.lol",
        "-addext",
        "subjectAltName=DNS:validapp.lol,DNS:six7.lol",
        "-keyout",
        keyPath,
        "-out",
        certificatePath,
    ], { stdio: "ignore" });

    backend = spawn(python, [path.join(six7Root, "scripts", "dev", "passkey_web_e2e_server.py")], {
        cwd: six7Root,
        env: {
            ...process.env,
            PYTHONUNBUFFERED: "1",
            S3_BUCKET: "valid-integration-test",
            S3_BUCKET_ENDPOINT: "http://127.0.0.1:9",
            S3_PUBLIC_BASE_URL: "https://validapp.lol/test-assets",
            DATABASE_URL: "",
            REDIS_URL: "",
            TWILIO_ACCOUNT_SID: "",
            TWILIO_AUTH_TOKEN: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    backend.stdout.on("data", (chunk) => { backendOutput += chunk.toString(); });
    backend.stderr.on("data", (chunk) => { backendOutput += chunk.toString(); });
    await waitForBackend();

    tlsServer = createTlsServer();
    await listen(tlsServer, tlsPort);

    browser = await chromium.launch({
        headless: true,
        args: [
            `--host-resolver-rules=MAP validapp.lol 127.0.0.1:${tlsPort}, MAP six7.lol 127.0.0.1:${tlsPort}`,
            "--ignore-certificate-errors",
        ],
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: {
            protocol: "ctap2",
            transport: "internal",
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
        },
    });
    await page.goto("https://validapp.lol/test");
    const result = await runBrowserJourney(page);

    assert.equal(result.signupUserId, result.loginUserId, "passkey must sign into its signup user");
    assert.equal(result.signupProfileUsername, result.username);
    assert.equal(result.loginProfileUsername, result.username);
    assert.equal(result.passkeyRegistered, true);
    assert.equal(result.credentialCount, 1);
    assert.equal(result.revokedStatus, 401, "logout must revoke the signup bearer token");
    assert.equal(result.registrationReplayStatus, 400, "registration challenge must be one-time");
    assert.equal(result.authenticationReplayStatus, 401, "sign-in challenge must be one-time");
    assert.equal(result.smsRouteStatus, 404, "the passkey harness must not expose an SMS route");
    assert.equal(result.tokenRotated, true, "sign-in must issue a fresh bearer token");
    assert.equal(result.signupPhoneVerification, null, "web signup must not invoke SMS");
    assert.equal(result.loginPhoneVerification, null, "passkey sign-in must not invoke SMS");

    console.log("PASS real WebAuthn signup → profile → logout → passkey sign-in → profile");
    console.log(`     RP six7.lol related origin validapp.lol; credential count ${result.credentialCount}`);
} catch (error) {
    if (backendOutput) console.error(backendOutput.trim());
    throw error;
} finally {
    if (browser) await browser.close();
    if (tlsServer) await new Promise((resolve) => tlsServer.close(resolve));
    if (backend && backend.exitCode === null) backend.kill("SIGTERM");
    rmSync(temporaryDirectory, { recursive: true, force: true });
}
