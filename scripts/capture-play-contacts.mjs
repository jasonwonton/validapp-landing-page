// Captures the web-v114 Play contact screens at 390x844 from the local demo.
// Usage: python3 -m http.server 4180 (repo root), then node scripts/capture-play-contacts.mjs
import { chromium, devices } from "@playwright/test";

const base = process.env.BASE_URL || "http://127.0.0.1:4180";
const out = new URL("../reports/web-v114-play-contacts/", import.meta.url).pathname;
const hash = (seed) => String(seed).repeat(64).slice(0, 64);
const contact = (seed, name, extra = {}) => ({ phone_number: hash(seed), name, is_six7_user: false, user_id: null, recommendation_strength: 0, vote_count: 0, visibility_boosts: [], ...extra });

const browser = await chromium.launch();
async function open({ classmates, contacts, picked = null }) {
    const context = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`${base}/app/?demo=1&signin=1`);
    await page.evaluate(async ({ classmateCount, contactRows, pickedRows }) => {
        const { DemoAPI } = await import("/app/demo-api.js");
        const original = DemoAPI.prototype.getClassmates;
        DemoAPI.prototype.getClassmates = async function (...args) { return (await original.apply(this, args)).slice(0, classmateCount); };
        const originalAll = DemoAPI.prototype.getAllContacts;
        DemoAPI.prototype.getAllContacts = async function (...args) {
            this.contacts ||= structuredClone(contactRows);
            const rows = await originalAll.apply(this, args);
            return rows.map((row) => row.phone_number.endsWith("4155550113") ? { ...row, is_six7_user: true, user_id: "jordan-account" } : row);
        };
        if (pickedRows) window.__demoPickedContacts = pickedRows;
    }, { classmateCount: classmates, contactRows: contacts, pickedRows: picked });
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    return { context, page };
}

{
    const { context, page } = await open({ classmates: 2, contacts: [contact(1, "Riley Stone")] });
    await page.getByText("Add more friends to play Valid.").waitFor();
    await page.screenshot({ path: `${out}1-play-lock-card-390x844.png` });
    await context.close();
}
{
    const { context, page } = await open({ classmates: 2, contacts: [contact(1, "Riley Stone"), contact(2, "Casey Moore")] });
    await page.locator("#playCard .play-card [data-choice]").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}2-play-round-contacts-and-classmates-390x844.png` });
    await context.close();
}
{
    const { context, page } = await open({
        classmates: 1,
        contacts: [],
        picked: [{ name: ["Casey Moore"], tel: ["(415) 555-0112"] }, { name: ["Jordan Fox"], tel: ["415-555-0113"] }, { name: ["Mom"], tel: ["4155550115"] }],
    });
    await page.locator("#playCard").getByRole("button", { name: "Find classmates" }).click();
    await page.locator("#classmatesDialog").getByRole("button", { name: "Choose contacts" }).click();
    await page.locator("#classmatesStatus", { hasText: "synced" }).waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}3-sync-dialog-result-390x844.png` });
    await context.close();
}
await browser.close();
