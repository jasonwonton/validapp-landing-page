const RUNTIME_STYLE_ATTRIBUTE = "data-valid-runtime-style";
const runtimeStyleRecords = new Map();
let nextRuntimeStyleId = 1;
let runtimeSheet = null;
let cleanupFrame = null;

function getRuntimeSheet() {
    if (runtimeSheet) return runtimeSheet;
    runtimeSheet = [...document.styleSheets].find((sheet) => {
        if (!sheet.href) return false;
        try {
            return new URL(sheet.href, location.href).pathname === "/app/styles.css";
        } catch (_) {
            return false;
        }
    }) || null;
    if (!runtimeSheet) throw new Error("The trusted app stylesheet is unavailable.");
    return runtimeSheet;
}

function deleteRuntimeRule(record) {
    const sheet = getRuntimeSheet();
    const index = [...sheet.cssRules].findIndex((rule) => rule === record.rule);
    if (index >= 0) sheet.deleteRule(index);
    record.element.removeAttribute(RUNTIME_STYLE_ATTRIBUTE);
    runtimeStyleRecords.delete(record.element);
}

function scheduleDisconnectedCleanup() {
    if (cleanupFrame !== null || !runtimeStyleRecords.size) return;
    cleanupFrame = requestAnimationFrame(() => {
        cleanupFrame = null;
        for (const record of runtimeStyleRecords.values()) {
            if (!record.element.isConnected) deleteRuntimeRule(record);
        }
    });
}

new MutationObserver(scheduleDisconnectedCleanup).observe(document, { childList: true, subtree: true });

function runtimeRecord(element) {
    let record = runtimeStyleRecords.get(element);
    if (record) return record;
    const id = String(nextRuntimeStyleId++);
    element.setAttribute(RUNTIME_STYLE_ATTRIBUTE, id);
    const sheet = getRuntimeSheet();
    const index = sheet.insertRule(`[${RUNTIME_STYLE_ATTRIBUTE}="${id}"] {}`, sheet.cssRules.length);
    record = { element, rule: sheet.cssRules[index] };
    runtimeStyleRecords.set(element, record);
    return record;
}

export function setRuntimeStyles(element, styles) {
    if (!element) return;
    const record = runtimeRecord(element);
    for (const [property, value] of Object.entries(styles)) {
        if (value === null || value === undefined || value === "") record.rule.style.removeProperty(property);
        else record.rule.style.setProperty(property, String(value));
    }
    scheduleDisconnectedCleanup();
}

export function clearRuntimeStyles(element, ...properties) {
    const record = runtimeStyleRecords.get(element);
    if (!record) return;
    for (const property of properties) record.rule.style.removeProperty(property);
    if (!record.rule.style.length) deleteRuntimeRule(record);
}
