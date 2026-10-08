// In-app replacements for window.confirm() and window.prompt(). Native
// dialogs look foreign in the installed PWA, block the page, and are
// suppressed after repeated use on iOS. These sheets use <dialog>.showModal()
// so they sit in the top layer above any other open dialog.
//
//   if (!await confirmSheet({ title: "Delete this question?", message: "This cannot be undone.", confirmLabel: "Delete", destructive: true })) return;
//   const report = await reasonSheet({ title: "Report this Story", reasons: [{ value: "spam", label: "Spam" }], allowOther: true });
//   if (report) await api.report(id, report.reason, report.details);

let sheetSequence = 0;
const MAX_DETAILS_LENGTH = 500;

function element(tag, properties = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(properties)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === "className") node.className = value;
        else if (key === "text") node.textContent = value;
        else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children);
    return node;
}

function presentSheet({ title, message, className = "", body = [], footer = [], confirmLabel, cancelLabel, destructive, prepare, result, cancelled, secondary }) {
    const id = `ui-sheet-${++sheetSequence}`;
    const previousFocus = document.activeElement;
    const heading = element("h2", { id: `${id}-title`, text: title || "Are you sure?" });
    const description = message ? element("p", { id: `${id}-message`, className: "ui-sheet-message", text: message }) : null;
    const confirm = element("button", {
        type: "submit", value: "confirm",
        className: destructive ? "danger-button ui-sheet-confirm" : "primary-button ui-sheet-confirm",
        text: confirmLabel || "OK",
    });
    const cancel = element("button", { type: "button", value: "cancel", className: "secondary-button ui-sheet-cancel", text: cancelLabel || "Cancel" });
    const form = element("form", { method: "dialog", className: "ui-sheet-content" }, [
        element("span", { className: "ui-sheet-grabber", "aria-hidden": "true" }),
        heading, ...(description ? [description] : []), ...body,
        element("div", { className: "ui-sheet-actions" }, [confirm, cancel]),
        ...footer,
    ]);
    const dialog = element("dialog", {
        className: `ui-sheet ${className}`.trim(),
        "aria-labelledby": heading.id,
        "aria-describedby": description?.id,
    }, [form]);
    if (destructive) dialog.dataset.destructive = "true";

    return new Promise((resolve) => {
        let settled = false;
        const finish = (confirmed) => {
            if (settled) return;
            settled = true;
            if (confirmed) resolve(result(form));
            else resolve(dialog.returnValue === "secondary" ? secondary : cancelled);
        };
        cancel.addEventListener("click", () => dialog.close(secondary === undefined ? "cancel" : "secondary"));
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (confirm.disabled) return;
            dialog.close("confirm");
        });
        // A tap on the dimmed backdrop targets the <dialog> itself, outside the sheet's box.
        dialog.addEventListener("click", (event) => {
            if (event.target !== dialog) return;
            const box = dialog.getBoundingClientRect();
            const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
            if (!inside) dialog.close("cancel");
        });
        dialog.addEventListener("cancel", () => { dialog.returnValue = "cancel"; });
        dialog.addEventListener("close", () => {
            finish(dialog.returnValue === "confirm");
            dialog.remove();
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
        }, { once: true });
        prepare?.({ dialog, form, confirm });
        document.body.append(dialog);
        dialog.showModal();
        // The primary action takes focus; a reason sheet starts on its first choice.
        (confirm.disabled ? form.querySelector("input, textarea") : confirm)?.focus({ preventScroll: true });
    });
}

/**
 * An iOS-style confirmation sheet.
 * @returns {Promise<boolean>} true only when the confirm button is chosen;
 *   Escape, Cancel, and a backdrop tap resolve false.
 */
export function confirmSheet({ title, message = "", confirmLabel = "OK", cancelLabel = "Cancel", destructive = false } = {}) {
    return presentSheet({ title, message, confirmLabel, cancelLabel, destructive, result: () => true, cancelled: false });
}

/**
 * Two real choices plus dismissal, e.g. an offer with a way past it.
 * @returns {Promise<"confirm" | "secondary" | null>} null on Escape or a backdrop tap.
 */
export function choiceSheet({ title, message = "", finePrint = "", confirmLabel = "OK", secondaryLabel = "Cancel" } = {}) {
    return presentSheet({
        title, message, confirmLabel, cancelLabel: secondaryLabel, destructive: false,
        footer: finePrint ? [element("p", { className: "ui-sheet-fineprint", text: finePrint })] : [],
        result: () => "confirm", secondary: "secondary", cancelled: null,
    });
}

/**
 * A sheet that asks for a reason (report flows). With `allowOther`, a
 * "Something else" choice reveals a free-text field.
 * @returns {Promise<{ reason: string, details: string } | null>} null when cancelled.
 */
export function reasonSheet({
    title, message = "", reasons = [], allowOther = false, otherLabel = "Something else",
    detailsLabel = "Tell us more (optional)", detailsPlaceholder = "Add details", confirmLabel = "Submit",
    cancelLabel = "Cancel", destructive = false, legend = "Choose a reason",
} = {}) {
    const name = `ui-sheet-reason-${sheetSequence + 1}`;
    const options = [...reasons, ...(allowOther && !reasons.some((reason) => reason.value === "other") ? [{ value: "other", label: otherLabel }] : [])];
    const fieldset = element("fieldset", { className: "ui-sheet-reasons" }, [
        element("legend", { className: "visually-hidden", text: legend }),
        ...options.map((option) => element("label", {}, [
            element("input", { type: "radio", name, value: option.value }),
            element("span", { text: option.label }),
        ])),
    ]);
    const details = element("textarea", { rows: "3", maxlength: String(MAX_DETAILS_LENGTH), placeholder: detailsPlaceholder, "aria-label": detailsLabel });
    const detailsField = element("label", { className: "ui-sheet-details", hidden: true }, [element("span", { text: detailsLabel }), details]);
    const selected = (form) => form.querySelector(`input[name="${name}"]:checked`)?.value || "";
    return presentSheet({
        title, message, confirmLabel, cancelLabel, destructive,
        className: "ui-reason-sheet", cancelled: null,
        body: [fieldset, ...(allowOther ? [detailsField] : [])],
        prepare: ({ form, confirm }) => {
            confirm.disabled = true;
            form.addEventListener("change", () => {
                const reason = selected(form);
                confirm.disabled = !reason;
                if (allowOther) {
                    const showDetails = reason === "other";
                    const wasHidden = detailsField.hidden;
                    detailsField.hidden = !showDetails;
                    if (showDetails && wasHidden) details.focus({ preventScroll: true });
                }
            });
        },
        result: (form) => ({ reason: selected(form), details: detailsField.hidden ? "" : details.value.trim().slice(0, MAX_DETAILS_LENGTH) }),
    });
}
