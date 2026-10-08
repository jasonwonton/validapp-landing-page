// The call listener lives outside the Chats UI so an incoming call rings as
// soon as the person signs in, not only after Chats has been opened. Chats
// reuses the same controller and event stream. The controller itself (and its
// dialog) loads on first use: the room preloads it when it shows a call button.
import { chatRealtime } from "../chat/realtime.js";

const services = new WeakMap();

export function callService({ api, getUser, getConfig, showToast }) {
    let service = services.get(api);
    if (service) return service;
    const historyListeners = new Set();
    let controller = null, loading = null;
    const load = () => loading ||= import("./index.js").then(({ createCallsController }) => {
        controller = createCallsController({
            api, getUser, getConfig, showToast,
            onCallChanged: (call) => { for (const listener of [...historyListeners]) listener(call); },
        });
        return controller;
    });
    const enabled = () => getConfig()?.enable_calls === true && getConfig()?.enable_web_calls === true;
    // Calls made after the module loaded stay synchronous, inside the tap that
    // started them (audio unlock and permission prompts need the gesture).
    const run = (method) => (...args) => controller ? controller[method](...args) : load().then((loaded) => loaded[method](...args));
    const calls = {
        enabled,
        preload: () => { if (enabled()) void load().catch(() => null); },
        isActive: () => Boolean(controller?.isActive()),
        start: run("start"),
        open: run("open"),
        handleRealtimeEvent(event) {
            if (!enabled() || !String(event?.type || "").startsWith("call_")) return;
            if (!controller && event.type !== "call_started") return;
            return run("handleRealtimeEvent")(event);
        },
        beforeSessionEnd: () => controller?.beforeSessionEnd() ?? Promise.resolve(),
    };
    const realtime = chatRealtime({ api, getUser });
    realtime.keepAliveWhile(() => calls.isActive());
    realtime.subscribe((event) => { void calls.handleRealtimeEvent(event)?.catch?.(() => null); });
    service = {
        calls,
        realtime,
        onCallChanged(listener) { historyListeners.add(listener); return () => historyListeners.delete(listener); },
    };
    services.set(api, service);
    return service;
}

/** Starts the lightweight listener at sign-in when web calls are enabled. */
export function startCallListener(context) {
    const service = callService(context);
    if (service.calls.enabled()) service.realtime.start();
    return service;
}

export async function stopCallListener(api) {
    const service = services.get(api);
    if (!service) return;
    service.realtime.stop();
    await service.calls.beforeSessionEnd();
}
