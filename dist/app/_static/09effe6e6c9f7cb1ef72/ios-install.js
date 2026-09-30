// iPhone and iPad have no install prompt: Add to Home Screen lives in Safari's
// Share menu, and Web Push only works in the installed app. This sheet shows the
// steps where Android shows its install button. Loaded on demand.
const SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M8 10.5H6.5A1.5 1.5 0 0 0 5 12v7.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5H16"/></svg>';
const ADD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>';
const APP_ICON = '<img src="../assets/pwa/icon-192.png" alt="" width="28" height="28" decoding="async">';

export function openIOSInstallSheet({ onClose } = {}) {
    document.querySelector(".ios-install-sheet")?.remove();
    const dialog = document.createElement("dialog");
    dialog.className = "ui-sheet ios-install-sheet";
    dialog.setAttribute("aria-labelledby", "iosInstallTitle");
    dialog.innerHTML = `<form method="dialog" class="ui-sheet-content">
        <span class="ui-sheet-grabber" aria-hidden="true"></span>
        <h2 id="iosInstallTitle">Add Valid to your Home Screen</h2>
        <p class="ui-sheet-message">Open Valid like an app and get notified when someone picks you.</p>
        <ol class="ios-install-steps">
            <li><span class="ios-install-icon">${SHARE_ICON}</span><span>Tap <strong>Share</strong> in Safari’s toolbar</span></li>
            <li><span class="ios-install-icon">${ADD_ICON}</span><span>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong></span></li>
            <li><span class="ios-install-icon">${APP_ICON}</span><span>Open <strong>Valid</strong> from your Home Screen</span></li>
        </ol>
        <p class="ios-install-note">On iPhone, notifications work only in the Home Screen app.</p>
        <div class="ui-sheet-actions"><button class="primary-button" type="submit">Got it</button></div>
    </form>`;
    dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    dialog.addEventListener("close", () => {
        dialog.remove();
        onClose?.();
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector("button[type=submit]").focus({ preventScroll: true });
    return dialog;
}
