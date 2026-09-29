const MAX_FEATURED_EFFECTS = 16;
const SUPPORTED_SCHEMA_MIN = 1;
const SUPPORTED_SCHEMA_MAX = 6;

const ORIGINAL_EFFECT = Object.freeze({
    id: "original",
    name: "Original",
    saturation: 1,
    contrast: 1,
    brightness: 0,
    grayscale: 0,
    sepia: 0,
    hueRotate: 0,
    washOpacity: 0,
    washColor: "#000000",
    washSecondaryColor: "#000000",
    vignette: 0,
    source: "browser",
});

const BROWSER_EFFECTS = Object.freeze([
    ORIGINAL_EFFECT,
    Object.freeze({
        ...ORIGINAL_EFFECT,
        id: "warm",
        name: "Warm",
        saturation: 1.08,
        contrast: 1.04,
        brightness: 0.02,
        sepia: 0.08,
        washOpacity: 0.055,
        washColor: "#FFB15E",
        washSecondaryColor: "#F29D56",
        vignette: 0.04,
    }),
    Object.freeze({
        ...ORIGINAL_EFFECT,
        id: "vivid",
        name: "Vivid",
        saturation: 1.28,
        contrast: 1.08,
        brightness: 0.01,
        vignette: 0.035,
    }),
    Object.freeze({
        ...ORIGINAL_EFFECT,
        id: "cool",
        name: "Cool",
        saturation: 0.98,
        contrast: 1.05,
        brightness: 0.02,
        hueRotate: -5,
        washOpacity: 0.065,
        washColor: "#59D9CF",
        washSecondaryColor: "#5C8DFF",
        vignette: 0.045,
    }),
    Object.freeze({
        ...ORIGINAL_EFFECT,
        id: "mono",
        name: "Mono",
        saturation: 0,
        contrast: 1.16,
        brightness: -0.01,
        grayscale: 1,
        vignette: 0.14,
    }),
]);

function boundedNumber(value, fallback, minimum, maximum) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
}

function safeHex(value, fallback) {
    const text = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : fallback;
}

function normalizeFeaturedEffect(row) {
    const recipe = row?.recipe;
    const schemaVersion = Number(recipe?.schema_version);
    if (!row?.id || !recipe || recipe.render_mode !== "live_recipe"
        || !Number.isInteger(schemaVersion)
        || schemaVersion < SUPPORTED_SCHEMA_MIN
        || schemaVersion > SUPPORTED_SCHEMA_MAX) return null;

    const backgroundStyle = String(recipe.background_style || "original");
    const backgroundOpacity = backgroundStyle === "original"
        ? 0
        : boundedNumber(recipe.background_opacity, 0, 0, 0.25);
    const effect = {
        ...ORIGINAL_EFFECT,
        id: `featured:${String(row.id).slice(0, 80)}`,
        name: String(row.name || recipe.name || "Featured").trim().slice(0, 60) || "Featured",
        saturation: boundedNumber(recipe.saturation, 1, 0.25, 2),
        contrast: boundedNumber(recipe.contrast, 1, 0.5, 1.75),
        brightness: boundedNumber(recipe.brightness, 0, -0.35, 0.35),
        washOpacity: Math.max(
            boundedNumber(recipe.wash_opacity, 0, 0, 0.45),
            backgroundOpacity,
        ),
        washColor: safeHex(recipe.background_color, safeHex(recipe.shadow_color, "#59D9CF")),
        washSecondaryColor: safeHex(recipe.background_secondary_color, safeHex(recipe.highlight_color, "#FFB15E")),
        vignette: boundedNumber(recipe.vignette_intensity, 0, 0, 0.6),
        source: "featured",
    };
    const hasVisibleBrowserTreatment = Math.abs(effect.saturation - 1) > 0.001
        || Math.abs(effect.contrast - 1) > 0.001
        || Math.abs(effect.brightness) > 0.001
        || effect.washOpacity > 0.001
        || effect.vignette > 0.001;
    return hasVisibleBrowserTreatment ? Object.freeze(effect) : null;
}

export function cameraEffectFilter(effect = ORIGINAL_EFFECT) {
    const saturation = boundedNumber(effect.saturation, 1, 0.25, 2);
    const contrast = boundedNumber(effect.contrast, 1, 0.5, 1.75);
    const brightness = 1 + boundedNumber(effect.brightness, 0, -0.35, 0.35);
    const grayscale = boundedNumber(effect.grayscale, 0, 0, 1);
    const sepia = boundedNumber(effect.sepia, 0, 0, 1);
    const hueRotate = boundedNumber(effect.hueRotate, 0, -30, 30);
    return `saturate(${saturation}) contrast(${contrast}) brightness(${brightness}) grayscale(${grayscale}) sepia(${sepia}) hue-rotate(${hueRotate}deg)`;
}

export function drawImageWithCameraEffect(context, image, width, height, effect = ORIGINAL_EFFECT) {
    const normalizedWidth = Math.max(1, Math.round(Number(width) || 1));
    const normalizedHeight = Math.max(1, Math.round(Number(height) || 1));
    context.save();
    if ("filter" in context) context.filter = cameraEffectFilter(effect);
    context.drawImage(image, 0, 0, normalizedWidth, normalizedHeight);
    context.restore();

    const washOpacity = boundedNumber(effect.washOpacity, 0, 0, 0.45);
    if (washOpacity > 0) {
        context.save();
        context.globalAlpha = washOpacity;
        const wash = context.createLinearGradient(0, 0, normalizedWidth, normalizedHeight);
        wash.addColorStop(0, safeHex(effect.washColor, "#59D9CF"));
        wash.addColorStop(1, safeHex(effect.washSecondaryColor, "#FFB15E"));
        context.fillStyle = wash;
        context.fillRect(0, 0, normalizedWidth, normalizedHeight);
        context.restore();
    }

    const vignette = boundedNumber(effect.vignette, 0, 0, 0.6);
    if (vignette > 0) {
        context.save();
        const radius = Math.hypot(normalizedWidth, normalizedHeight) * 0.54;
        const shade = context.createRadialGradient(
            normalizedWidth / 2,
            normalizedHeight / 2,
            radius * 0.35,
            normalizedWidth / 2,
            normalizedHeight / 2,
            radius,
        );
        shade.addColorStop(0, "rgba(0,0,0,0)");
        shade.addColorStop(1, `rgba(0,0,0,${vignette})`);
        context.fillStyle = shade;
        context.fillRect(0, 0, normalizedWidth, normalizedHeight);
        context.restore();
    }
}

export function createCameraEffectPicker({ fieldset, api, onChange }) {
    if (!fieldset) throw new Error("Camera effect picker needs a fieldset.");
    const list = fieldset.querySelector("[data-camera-effect-options]");
    if (!list) throw new Error("Camera effect picker needs an options container.");
    let effects = [...BROWSER_EFFECTS];
    let current = ORIGINAL_EFFECT;
    let loaded = false;
    let loadingPromise = null;
    let disabled = false;
    let mediaKind = null;

    function render() {
        list.replaceChildren(...effects.map((effect) => {
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.cameraEffect = effect.id;
            button.className = effect.id === current.id ? "selected" : "";
            button.setAttribute("aria-pressed", effect.id === current.id ? "true" : "false");
            button.setAttribute("aria-label", `${effect.name} photo effect${effect.source === "featured" ? ", Featured" : ""}`);
            button.disabled = disabled;
            const mark = document.createElement("span");
            mark.textContent = effect.name.slice(0, 1).toUpperCase();
            mark.setAttribute("aria-hidden", "true");
            const label = document.createElement("small");
            label.textContent = effect.name;
            button.append(mark, label);
            button.addEventListener("click", async () => {
                if (disabled || mediaKind !== "photo" || effect.id === current.id) return;
                current = effect;
                render();
                await onChange?.(effect);
            });
            return button;
        }));
    }

    async function load() {
        if (loaded) return effects;
        if (loadingPromise) return loadingPromise;
        loadingPromise = (async () => {
            try {
                const response = typeof api?.getFeaturedCameraFilters === "function"
                    ? await api.getFeaturedCameraFilters()
                    : { filters: [] };
                const featured = (Array.isArray(response) ? response : response?.filters || [])
                    .slice(0, MAX_FEATURED_EFFECTS)
                    .map(normalizeFeaturedEffect)
                    .filter(Boolean);
                const seen = new Set(effects.map((effect) => effect.id));
                effects.push(...featured.filter((effect) => {
                    if (seen.has(effect.id)) return false;
                    seen.add(effect.id);
                    return true;
                }));
            } catch (_) {
                // The local effects remain available offline and when the
                // optional server-managed Featured catalog is unavailable.
            } finally {
                loaded = true;
                loadingPromise = null;
                render();
            }
            return effects;
        })();
        return loadingPromise;
    }

    function setMediaKind(kind) {
        mediaKind = kind || null;
        fieldset.classList.toggle("hidden", mediaKind !== "photo");
        if (mediaKind === "photo") void load();
    }

    function reset() {
        current = ORIGINAL_EFFECT;
        mediaKind = null;
        fieldset.classList.add("hidden");
        render();
    }

    function setDisabled(value) {
        disabled = Boolean(value);
        fieldset.disabled = disabled;
        render();
    }

    render();
    return {
        load,
        reset,
        setDisabled,
        setMediaKind,
        value: () => current,
    };
}

export { BROWSER_EFFECTS, ORIGINAL_EFFECT };
