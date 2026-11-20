// Server announcement banner, matching iOS BannerNotificationView: icon by
// type, one-line title, two-line message, a chevron when it links somewhere,
// ✕ only when dismissible, springing down from the top. Loaded on demand.
const DISMISSED_KEY = "valid:dismissed-banners";
const ICONS = {
    info: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.2l-1.8-5.6-5.7-1.8L10.2 9 12 3.5Z"/><path d="m18.5 15.5.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z"/>',
    warning: '<path d="M10.3 4.2a2 2 0 0 1 3.4 0l7.6 13.2a2 2 0 0 1-1.7 3H4.4a2 2 0 0 1-1.7-3l7.6-13.2Z"/><path class="banner-icon-cut" d="M12 9.5v4.5M12 17v.2"/>',
    error: '<circle cx="12" cy="12" r="9"/><path class="banner-icon-cut" d="m9 9 6 6m0-6-6 6"/>',
    success: '<circle cx="12" cy="12" r="9"/><path class="banner-icon-cut" d="m8 12.5 2.7 2.7L16.5 9.5"/>',
};

function dismissedIds() {
    try {
        const ids = JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]");
        return Array.isArray(ids) ? ids.map(String) : [];
    } catch (_) {
        return [];
    }
}

export function bannerWasDismissed(banner) {
    return dismissedIds().includes(String(banner?.id));
}

function rememberDismissal(banner) {
    try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissedIds().filter((id) => id !== String(banner.id)), String(banner.id)].slice(-50)));
    } catch (_) {
        // Hidden for this session only when storage is unavailable.
    }
}

function safeActionURL(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch (_) {
        return null;
    }
}

export function hideBanner() {
    document.querySelector(".app-banner")?.remove();
}

export function showBanner(banner) {
    const current = document.querySelector(".app-banner");
    if (!banner || bannerWasDismissed(banner) || banner.min_app_version) return hideBanner();
    if (current?.dataset.bannerId === String(banner.id)) return;
    current?.remove();
    const type = Object.hasOwn(ICONS, String(banner.banner_type).toLowerCase()) ? String(banner.banner_type).toLowerCase() : "info";
    const hasAction = Boolean(banner.action_url);
    const dismissible = banner.dismissible !== false;
    const root = document.createElement("aside");
    root.className = "app-banner";
    root.dataset.bannerId = String(banner.id);
    root.dataset.bannerType = type;
    root.setAttribute("role", "status");
    root.setAttribute("aria-label", "Announcement");
    const body = document.createElement(hasAction ? "button" : "div");
    body.className = "app-banner-body";
    if (hasAction) body.type = "button";
    body.innerHTML = `<svg class="app-banner-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[type]}</svg><span class="app-banner-copy"><strong></strong><small></small><span class="visually-hidden"></span></span>${hasAction ? '<span class="app-banner-chevron" aria-hidden="true">›</span>' : ""}`;
    body.querySelector("strong").textContent = String(banner.title || "");
    body.querySelector("small").textContent = String(banner.message || "");
    if (hasAction) body.querySelector(".visually-hidden").textContent = `, ${banner.action_text || "Open link"}`;
    root.append(body);

    const dismiss = () => {
        rememberDismissal(banner);
        root.classList.add("leaving");
        setTimeout(() => root.remove(), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300);
    };
    if (hasAction) {
        body.addEventListener("click", () => {
            const url = safeActionURL(banner.action_url);
            if (url) window.open(url, "_blank", "noopener");
            // Like iOS, following (or failing to follow) the link dismisses it.
            dismiss();
        });
    }
    if (dismissible) {
        const close = document.createElement("button");
        close.type = "button";
        close.className = "app-banner-close";
        close.setAttribute("aria-label", "Dismiss");
        close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg>';
        close.addEventListener("click", dismiss);
        root.append(close);
    }
    document.body.append(root);
}
