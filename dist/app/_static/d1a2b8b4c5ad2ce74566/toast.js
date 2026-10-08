// The app-wide toast (#toast in index.html). It is a manual popover, and it is
// re-shown on every message so it becomes the newest top-layer element and
// paints above any open modal <dialog> or sheet. Browsers without the Popover
// API fall back to the fixed-position, class-based toast.
//
//   import { showToast } from "./toast.js";
//   showToast("Link copied");

const VISIBLE_MS = 2800;
const EXIT_MS = 220;
let visibleTimer = null;
let hideTimer = null;

export function showToast(message, { duration = VISIBLE_MS } = {}) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    const popover = toast.hasAttribute("popover") && typeof toast.showPopover === "function";
    clearTimeout(visibleTimer);
    clearTimeout(hideTimer);
    if (popover) {
        try {
            if (toast.matches(":popover-open")) toast.hidePopover();
            toast.showPopover();
        } catch (_) { /* The class-based toast below still shows. */ }
    }
    toast.textContent = message;
    toast.classList.add("visible");
    visibleTimer = setTimeout(() => {
        toast.classList.remove("visible");
        if (!popover) return;
        hideTimer = setTimeout(() => {
            try { if (!toast.classList.contains("visible") && toast.matches(":popover-open")) toast.hidePopover(); } catch (_) { /* Already hidden. */ }
        }, EXIT_MS);
    }, duration);
}
