// Parents page: "Set up parental controls". A parent enters their child's
// @username or phone number; the server makes Parent access appear on that
// child's iPhone (POST /api/v1/parent-links/enable). It never grants access:
// the child still links the parent's number with a code from the parent's
// phone, which the steps shown afterwards walk through. The server answers
// the same for every account, so this page never says whether one exists.
(() => {
    const form = document.getElementById("parent-setup-form");
    if (!form) return;
    const input = document.getElementById("child-account");
    const button = document.getElementById("enable-parent-access");
    const error = document.getElementById("parent-setup-error");
    const steps = document.getElementById("parent-link-steps");
    const entered = document.getElementById("enabled-account");
    const label = button.textContent;
    form.hidden = false;

    const USERNAME = /^(?=.{3,30}$)[a-z0-9_]+(?:\.[a-z0-9_]+)*$/;

    // "(555) 010-0136", "+1 555 010 0136" → a phone number; anything else is
    // read as a username.
    function parse(raw) {
        const value = raw.trim();
        if (/^\+?[\d\s().-]+$/.test(value)) {
            // Valid accounts use US numbers: 10 digits, or 11 starting with 1.
            const digits = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
            if (digits.length !== 10) {
                return { error: "Enter their 10-digit phone number, with the area code." };
            }
            return { body: { phone_number: value }, shown: value };
        }
        const username = value.replace(/^@/, "").toLowerCase();
        if (!USERNAME.test(username)) {
            return { error: "Enter their @username (3–30 letters, numbers, underscores, or dots) or their phone number." };
        }
        return { body: { username }, shown: `@${username}` };
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (button.disabled) return;
        error.textContent = "";
        const parsed = parse(input.value);
        if (parsed.error) {
            error.textContent = parsed.error;
            input.focus();
            return;
        }
        button.disabled = true;
        button.textContent = "Turning on…";
        form.setAttribute("aria-busy", "true");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch("/api/v1/parent-links/enable", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(parsed.body),
                credentials: "omit",
                cache: "no-store",
                signal: controller.signal,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.ready !== true) {
                throw new Error(
                    typeof data.detail === "string"
                        ? data.detail
                        : "We couldn't turn on Parent access right now. Please try again in a few minutes."
                );
            }
            entered.textContent = parsed.shown;
            form.hidden = true;
            steps.hidden = false;
            steps.focus();
            steps.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (failure) {
            error.textContent =
                failure.name === "AbortError" || failure instanceof TypeError
                    ? "We couldn't connect. Check your connection and try again."
                    : failure.message;
        } finally {
            clearTimeout(timeout);
            button.disabled = false;
            button.textContent = label;
            form.removeAttribute("aria-busy");
        }
    });

    document.getElementById("setup-another-child").addEventListener("click", () => {
        steps.hidden = true;
        entered.textContent = "";
        form.hidden = false;
        form.reset();
        error.textContent = "";
        input.focus();
    });
})();
