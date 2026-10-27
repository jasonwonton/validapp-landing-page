(() => {
    const form = document.getElementById("parent-setup-form");
    const input = document.getElementById("child-username");
    const button = document.getElementById("enable-parent-access");
    const error = document.getElementById("parent-setup-error");
    const steps = document.getElementById("parent-link-steps");
    form.hidden = false;

    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (button.disabled) return;
        error.textContent = "";
        const username = input.value.trim().replace(/^@/, "").toLowerCase();
        if (!/^[a-z0-9_]{3,30}$/.test(username)) {
            error.textContent = "Enter their username: 3–30 letters, numbers, or underscores.";
            input.focus();
            return;
        }
        button.disabled = true;
        button.textContent = "Enabling…";
        form.setAttribute("aria-busy", "true");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch("/api/v1/parent-links/enable", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username }),
                credentials: "omit",
                cache: "no-store",
                signal: controller.signal,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.ready !== true) {
                throw new Error(typeof data.detail === "string" ? data.detail : "We couldn't enable Parent access right now. Please try again later.");
            }
            document.getElementById("enabled-username").textContent = `@${username}`;
            form.hidden = true;
            steps.hidden = false;
            steps.focus();
        } catch (failure) {
            error.textContent = failure.name === "AbortError" || failure instanceof TypeError
                ? "We couldn't connect. Check your connection and try again."
                : failure.message;
        } finally {
            clearTimeout(timeout);
            button.disabled = false;
            button.textContent = "Enable Parent access";
            form.removeAttribute("aria-busy");
        }
    });

    document.getElementById("setup-another-child").addEventListener("click", () => {
        steps.hidden = true;
        document.getElementById("enabled-username").textContent = "";
        form.hidden = false;
        form.reset();
        error.textContent = "";
        input.focus();
    });
})();
