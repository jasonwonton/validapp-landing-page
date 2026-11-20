// Review screen editing, after iOS ChatMediaCaptureView + CameraReviewEditingTools:
// swipe colour filters with a name flash, pinch/rotate/pan with centre guides,
// drawing (MediaDrawingCanvas) and caption bars (MediaCaptionLabel/Editor).
// Filters, zoom, drawings and stickers are burned into the exported photo.
// Captions travel as `media_text_overlay` like iOS, so the server can moderate
// their text and every client draws them at the same place.
import { setRuntimeStyles } from "../runtime-style.js";
import { applyReviewFilter, cycleFilterIndex, loadReviewFilters, REVIEW_FILTERS } from "./review-filters.js";
import { drawScaled } from "./photo-pipeline.js";

export const MAX_CAPTIONS = 6;
export const CAPTION_LIMIT = 160;
const CAPTION_MIN_Y = 0.12;
const CAPTION_MAX_Y = 0.86;
const CAPTION_DEFAULT_Y = 0.44;
const TAP_TOLERANCE = 12;
const SWIPE_MIN = 44;
const DISPLAY_MAX = 1600;
const MIN_SCALE = 0.5;
const MAX_SCALE = 6;
const SCALE_SNAP = 0.06;
const ROTATION_DEAD_ZONE = Math.PI / 180 * 8;
const ROTATION_SNAP = Math.PI / 180 * 4;
const CENTER_SNAP = 0.03;
const GUIDE_SNAP = 8;

export const DRAWING_COLORS = Object.freeze([
    ["White", "#FFFFFF"], ["Black", "#000000"], ["Red", "#FF3B30"], ["Yellow", "#FFCC00"],
    ["Green", "#34C759"], ["Blue", "#007AFF"], ["Purple", "#AF52DE"],
]);
export const BRUSH_WIDTHS = Object.freeze([4, 9, 16]);

const clampY = (value) => Math.min(CAPTION_MAX_Y, Math.max(CAPTION_MIN_Y, Number(value) || CAPTION_DEFAULT_Y));
const rotate = (x, y, angle) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
const identity = () => ({ scale: 1, rotation: 0, cx: 0.5, cy: 0.5 });
const isIdentity = (t) => Math.abs(t.scale - 1) < 0.001 && Math.abs(t.rotation) < 0.0001 && Math.abs(t.cx - 0.5) < 0.0001 && Math.abs(t.cy - 0.5) < 0.0001;
const sameTransform = (a, b) => a.scale === b.scale && a.rotation === b.rotation && a.cx === b.cx && a.cy === b.cy;

const glyphs = {
    pencil: '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 20l1.2-4.8L16 4.4a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L8.8 18.8Z M14 6.5l3.5 3.5"/></svg>',
    check: '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
    undo: '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12"/></svg>',
    trash: '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15"/></svg>',
};

// Draws the photo the way the review shows it: centre of `transform` in the
// middle of the frame, then turned and scaled about it (PhotoZoomCompositor).
export function drawTransformed(context, image, width, height, transform) {
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    context.save();
    context.imageSmoothingQuality = "high";
    if (!isIdentity(transform)) {
        context.translate(width / 2, height / 2);
        context.rotate(transform.rotation);
        context.scale(transform.scale, transform.scale);
        context.translate(-transform.cx * width, -transform.cy * height);
    }
    context.drawImage(image, 0, 0, width, height);
    context.restore();
}

export function drawStrokes(context, strokes, width, height) {
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const stroke of strokes) {
        if (!stroke.points.length) continue;
        context.strokeStyle = stroke.color;
        context.lineWidth = stroke.width * width;
        context.beginPath();
        const [firstX, firstY] = stroke.points[0];
        context.moveTo(firstX * width, firstY * height);
        if (stroke.points.length === 1) context.lineTo(firstX * width + 0.01, firstY * height);
        for (const [x, y] of stroke.points.slice(1)) context.lineTo(x * width, y * height);
        context.stroke();
    }
    context.restore();
}

export function createReviewEditor({ preview, toolColumn, drawTools, api, haptic, showToast, isBusy = () => false, onChange = () => {} }) {
    const stage = document.createElement("div");
    stage.className = "review-stage";
    stage.dataset.reviewStage = "";
    stage.innerHTML = `<canvas class="review-photo" role="img" aria-label="Photo preview" tabindex="0"></canvas><canvas class="review-drawing" aria-hidden="true"></canvas><div class="review-guides" aria-hidden="true"><i class="review-guide-v" hidden></i><i class="review-guide-h" hidden></i></div><div class="review-captions"></div><p class="review-filter-name" aria-hidden="true"></p><p class="visually-hidden review-filter-status" aria-live="polite"></p><span class="review-duration" hidden></span>`;
    const photoCanvas = stage.querySelector(".review-photo");
    const drawingCanvas = stage.querySelector(".review-drawing");
    const captionLayer = stage.querySelector(".review-captions");
    const drawButton = toolColumn.querySelector("[data-photo-draw]");
    const undoZoomButton = toolColumn.querySelector("[data-undo-zoom]");
    const feedback = (kind) => { try { haptic?.(kind); } catch (_) { /* optional */ } };

    let mode = null; // "photo" | "video" | null
    let photo = null; // full-resolution working canvas
    let display = null; // screen-sized copy
    let graded = null; // screen-sized copy with the current filter
    let aspect = 3 / 4;
    let filters = [...REVIEW_FILTERS];
    let filterIndex = 0;
    let filtersLoaded = false;
    let transform = identity();
    let history = [];
    let guides = { v: false, h: false };
    let showingGuides = false;
    let strokes = [];
    let activeStroke = null;
    let drawing = false;
    let drawColor = DRAWING_COLORS[0][1];
    let drawWidth = 5;
    let captions = [];
    let editing = null;
    let nextCaptionId = 1;
    let keyboardCaption = false;
    let lastPinchAt = 0;
    const pointers = new Map();
    let gesture = null;
    let frame = 0;

    function stageSize() { return { width: stage.clientWidth, height: stage.clientHeight }; }
    function layout() {
        if (!mode || !preview.isConnected) return;
        const width = preview.clientWidth, height = preview.clientHeight;
        if (!width || !height) return;
        let w = width, h = width / aspect;
        if (h > height) { h = height; w = height * aspect; }
        setRuntimeStyles(stage, { left: `${(width - w) / 2}px`, top: `${(height - h) / 2}px`, width: `${w}px`, height: `${h}px` });
        const ratio = Math.min(2, devicePixelRatio || 1);
        for (const canvas of [photoCanvas, drawingCanvas]) {
            const cw = Math.max(1, Math.round(w * ratio)), ch = Math.max(1, Math.round(h * ratio));
            if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
        }
        render();
        renderStrokes();
        renderCaptions();
    }
    new ResizeObserver(() => layout()).observe(preview);

    function render() {
        frame = 0;
        if (mode !== "photo" || !graded) return;
        drawTransformed(photoCanvas.getContext("2d", { alpha: false }), graded, photoCanvas.width, photoCanvas.height, transform);
        stage.querySelector(".review-guide-v").hidden = !guides.v;
        stage.querySelector(".review-guide-h").hidden = !guides.h;
        undoZoomButton.hidden = !history.length || drawing;
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(render); }

    function regrade() {
        if (!display) return;
        if (graded && graded !== display) graded.width = graded.height = 0;
        const filter = filters[filterIndex];
        if (!filter || filter.id === "none") graded = display;
        else {
            graded = drawScaled(display, { x: 0, y: 0, width: display.width, height: display.height }, display.width, display.height);
            applyReviewFilter(graded, filter);
        }
        render();
    }

    function flashFilterName(name) {
        const label = stage.querySelector(".review-filter-name");
        label.textContent = name;
        label.classList.remove("show");
        void label.offsetWidth;
        label.classList.add("show");
        stage.querySelector(".review-filter-status").textContent = `${name} filter`;
    }
    function cycleFilter(step) {
        if (mode !== "photo" || drawing || isBusy()) return;
        filterIndex = cycleFilterIndex(filterIndex, step, filters.length);
        feedback("selection");
        flashFilterName(filters[filterIndex].name);
        regrade();
        onChange();
    }

    // Pinch, rotate and pan (ReviewPhotoZoom).
    function photoPoint(x, y, t, size) {
        const [ox, oy] = rotate(x - size.width / 2, y - size.height / 2, -t.rotation);
        return [t.cx + ox / (size.width * t.scale), t.cy + oy / (size.height * t.scale)];
    }
    function clampCenter(t) { return { ...t, cx: Math.min(1, Math.max(0, t.cx)), cy: Math.min(1, Math.max(0, t.cy)) }; }
    function snappedToCenter(proposed, size) {
        let [sx, sy] = rotate((0.5 - proposed.cx) * size.width * proposed.scale, (0.5 - proposed.cy) * size.height * proposed.scale, proposed.rotation);
        const next = { v: Math.abs(sx) < GUIDE_SNAP, h: Math.abs(sy) < GUIDE_SNAP };
        if (!next.v && !next.h) return [proposed, next];
        if (next.v) sx = 0;
        if (next.h) sy = 0;
        const [px, py] = rotate(sx, sy, -proposed.rotation);
        const snapped = clampCenter({ ...proposed, cx: 0.5 - px / (size.width * proposed.scale), cy: 0.5 - py / (size.height * proposed.scale) });
        const [lx, ly] = rotate((0.5 - snapped.cx) * size.width * snapped.scale, (0.5 - snapped.cy) * size.height * snapped.scale, snapped.rotation);
        return [snapped, { v: next.v && Math.abs(lx) < 0.5, h: next.h && Math.abs(ly) < 0.5 }];
    }
    function showGuides(next) {
        const changed = next.v !== guides.v || next.h !== guides.h;
        if (changed && showingGuides && ((next.v && !guides.v) || (next.h && !guides.h))) feedback("selection");
        guides = next;
        showingGuides = true;
    }
    function pinchState() {
        const [a, b] = [...pointers.values()];
        const bounds = stage.getBoundingClientRect();
        return {
            distance: Math.hypot(a.x - b.x, a.y - b.y),
            angle: Math.atan2(b.y - a.y, b.x - a.x),
            x: (a.x + b.x) / 2 - bounds.left,
            y: (a.y + b.y) / 2 - bounds.top,
        };
    }
    function beginPinch() {
        const state = pinchState();
        const size = stageSize();
        if (!gesture || gesture.type !== "pinch") gesture = { type: "pinch", before: { ...transform }, slack: null };
        gesture.start = { scale: transform.scale, rotation: transform.rotation, anchor: photoPoint(state.x, state.y, transform, size), distance: state.distance, angle: state.angle };
        if (gesture.slack !== null) gesture.slack = 0;
        showingGuides = false;
        lastPinchAt = performance.now();
    }
    function updatePinch(magnification, turned, x, y) {
        const size = stageSize();
        const start = gesture.start;
        if (!size.width || !size.height || !(magnification > 0)) return;
        lastPinchAt = performance.now();
        if (gesture.slack === null && Math.abs(turned) >= ROTATION_DEAD_ZONE) gesture.slack = turned;
        const rotation = start.rotation + (gesture.slack === null ? 0 : turned - gesture.slack);
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, start.scale * magnification));
        const [ox, oy] = rotate(x - size.width / 2, y - size.height / 2, -rotation);
        const proposed = clampCenter({ scale, rotation, cx: start.anchor[0] - ox / (size.width * scale), cy: start.anchor[1] - oy / (size.height * scale) });
        const [snapped, next] = snappedToCenter(proposed, size);
        transform = snapped;
        showGuides(next);
        schedule();
    }
    function endPinch() {
        if (!gesture || gesture.type !== "pinch") return;
        const before = gesture.before;
        gesture = null;
        showingGuides = false;
        guides = { v: false, h: false };
        let settled = { ...transform };
        if (Math.abs(settled.scale - 1) < SCALE_SNAP) settled.scale = 1;
        if (Math.abs(settled.rotation) < ROTATION_SNAP) settled.rotation = 0;
        if (settled.scale === 1 && settled.rotation === 0 && Math.abs(settled.cx - 0.5) < CENTER_SNAP && Math.abs(settled.cy - 0.5) < CENTER_SNAP) settled = identity();
        if (!sameTransform(before, settled)) history.push(before);
        transform = settled;
        lastPinchAt = performance.now();
        schedule();
        onChange();
    }
    function undoZoom() {
        const previous = history.pop();
        if (!previous) return;
        transform = previous;
        feedback("light");
        schedule();
        onChange();
    }

    // Drawing (MediaDrawingCanvas): points and widths are relative to the photo.
    function renderStrokes() {
        const context = drawingCanvas.getContext("2d");
        context.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        drawStrokes(context, activeStroke ? [...strokes, activeStroke] : strokes, drawingCanvas.width, drawingCanvas.height);
    }
    function strokePoint(event) {
        const bounds = stage.getBoundingClientRect();
        return [Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)), Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))];
    }
    function renderDrawTools() {
        drawTools.hidden = !drawing;
        toolColumn.classList.toggle("is-drawing", drawing);
        drawButton.setAttribute("aria-label", drawing ? "Done drawing" : "Draw on this");
        drawButton.setAttribute("aria-pressed", String(drawing));
        drawButton.innerHTML = drawing ? glyphs.check : glyphs.pencil;
        drawTools.querySelectorAll("[data-draw-color]").forEach((button) => {
            const chosen = button.dataset.drawColor === drawColor;
            button.classList.toggle("selected", chosen);
            button.setAttribute("aria-pressed", String(chosen));
        });
        drawTools.querySelectorAll("[data-draw-width]").forEach((button) => {
            const chosen = Math.abs(Number(button.dataset.drawWidth) - drawWidth) < 0.5;
            button.classList.toggle("selected", chosen);
            button.setAttribute("aria-pressed", String(chosen));
        });
        drawTools.querySelectorAll("[data-draw-undo], [data-draw-clear]").forEach((button) => { button.disabled = !strokes.length; });
        stage.classList.toggle("is-drawing", drawing);
        render();
    }
    drawTools.innerHTML = `${DRAWING_COLORS.map(([name, color]) => `<button type="button" class="review-swatch" data-draw-color="${color}" aria-label="${name}"><span></span></button>`).join("")}${BRUSH_WIDTHS.map((width, index) => `<button type="button" class="review-brush" data-draw-width="${width}" aria-label="${["Thin", "Medium", "Thick"][index]} brush"><span></span></button>`).join("")}<button type="button" class="review-draw-action" data-draw-undo aria-label="Undo drawing stroke">${glyphs.undo}</button><button type="button" class="review-draw-action" data-draw-clear aria-label="Clear drawing">${glyphs.trash}</button>`;
    drawTools.querySelectorAll("[data-draw-color]").forEach((button) => {
        setRuntimeStyles(button.querySelector("span"), { background: button.dataset.drawColor });
        button.addEventListener("click", () => { drawColor = button.dataset.drawColor; feedback("light"); renderDrawTools(); });
    });
    drawTools.querySelectorAll("[data-draw-width]").forEach((button, index) => {
        setRuntimeStyles(button.querySelector("span"), { width: `${6 + index * 5}px`, height: `${6 + index * 5}px` });
        button.addEventListener("click", () => { drawWidth = Number(button.dataset.drawWidth); feedback("light"); renderDrawTools(); });
    });
    drawTools.querySelector("[data-draw-undo]").addEventListener("click", () => { strokes.pop(); renderStrokes(); renderDrawTools(); onChange(); });
    drawTools.querySelector("[data-draw-clear]").addEventListener("click", () => { strokes = []; renderStrokes(); renderDrawTools(); onChange(); });
    function setDrawing(value) {
        if (mode !== "photo" || isBusy()) value = false;
        if (value) commitCaption();
        drawing = Boolean(value);
        activeStroke = null;
        feedback("light");
        renderDrawTools();
    }
    drawButton.addEventListener("click", () => setDrawing(!drawing));
    undoZoomButton.addEventListener("click", undoZoom);

    // Captions: full-width translucent bars that move only up and down.
    function renderCaptions() {
        const focused = document.activeElement;
        const keep = new Set();
        for (const caption of captions) {
            if (editing?.id === caption.id) continue;
            let node = captionLayer.querySelector(`[data-caption-id="${caption.id}"]`);
            if (!node) {
                node = document.createElement("div");
                node.className = "review-caption";
                node.tabIndex = 0;
                node.setAttribute("role", "button");
                node.dataset.captionId = String(caption.id);
                bindCaption(node, caption.id);
                captionLayer.append(node);
            }
            node.textContent = caption.text;
            node.setAttribute("aria-label", `Media text: ${caption.text}. Tap to edit or drag to move`);
            placeCaption(node, caption.y);
            keep.add(node);
        }
        let editor = captionLayer.querySelector(".review-caption-editor");
        if (editing) {
            if (!editor) {
                editor = document.createElement("textarea");
                editor.className = "review-caption review-caption-editor";
                editor.rows = 1;
                editor.maxLength = CAPTION_LIMIT;
                editor.enterKeyHint = "done";
                editor.setAttribute("aria-label", "Caption");
                editor.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") { event.preventDefault(); finishCaption(); }
                    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finishCaption(); }
                });
                editor.addEventListener("input", () => {
                    if (!editing) return;
                    // Return commits and pasted line breaks never split a caption.
                    if (editor.value.includes("\n")) {
                        editor.value = editor.value.replace(/\s*\n+\s*/g, " ").trim().slice(0, CAPTION_LIMIT);
                        editing.text = editor.value;
                        finishCaption();
                        return;
                    }
                    editing.text = editor.value;
                    fitEditor(editor);
                });
                editor.addEventListener("blur", () => { if (editing) setTimeout(() => { if (editing && document.activeElement !== editor) finishCaption(); }, 0); });
                captionLayer.append(editor);
            }
            if (editor.value !== editing.text) editor.value = editing.text;
            keep.add(editor);
            fitEditor(editor);
        }
        for (const node of [...captionLayer.children]) if (!keep.has(node)) node.remove();
        if (editing && editor && focused !== editor) editor.focus({ preventScroll: true });
    }
    function fitEditor(editor) {
        setRuntimeStyles(editor, { height: "auto" });
        setRuntimeStyles(editor, { height: `${Math.min(editor.scrollHeight, 4 * 30 + 8)}px` });
        placeCaption(editor, editing?.y ?? CAPTION_DEFAULT_Y);
    }
    // Centred on its y without a transform, so hit testing matches what is drawn.
    function placeCaption(node, y) {
        setRuntimeStyles(node, { top: `calc(${y * 100}% - ${node.offsetHeight / 2}px)` });
    }
    function bindCaption(node, id) {
        let drag = null;
        node.addEventListener("pointerdown", (event) => {
            if (drawing || isBusy()) return;
            event.stopPropagation();
            const caption = captions.find((item) => item.id === id);
            if (!caption) return;
            drag = { pointer: event.pointerId, startY: event.clientY, originY: caption.y, moved: false };
            try { node.setPointerCapture(event.pointerId); } catch (_) { /* synthetic pointers */ }
        });
        node.addEventListener("pointermove", (event) => {
            if (!drag || drag.pointer !== event.pointerId) return;
            const caption = captions.find((item) => item.id === id);
            const height = stage.clientHeight;
            if (!caption || !height) return;
            if (Math.abs(event.clientY - drag.startY) > 6) drag.moved = true;
            if (!drag.moved) return;
            caption.y = clampY(drag.originY + (event.clientY - drag.startY) / height);
            placeCaption(node, caption.y);
        });
        const end = (event) => {
            if (!drag || drag.pointer !== event.pointerId) return;
            const moved = drag.moved;
            drag = null;
            event.stopPropagation();
            if (moved) { onChange(); return; }
            if (event.type === "pointerup") editCaption(id);
        };
        node.addEventListener("pointerup", end);
        node.addEventListener("pointercancel", end);
        node.addEventListener("keydown", (event) => {
            const caption = captions.find((item) => item.id === id);
            if (!caption) return;
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); editCaption(id); }
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                event.preventDefault();
                caption.y = clampY(caption.y + (event.key === "ArrowUp" ? -0.02 : 0.02));
                renderCaptions();
                onChange();
            }
        });
    }
    function beginCaption(y = CAPTION_DEFAULT_Y, { viaKeyboard = false } = {}) {
        if (!mode || isBusy()) return;
        if (drawing) setDrawing(false);
        if (editing) return;
        if (captions.length >= MAX_CAPTIONS) {
            showToast?.(`You can add up to ${MAX_CAPTIONS} captions.`);
            return;
        }
        keyboardCaption = viaKeyboard;
        editing = { id: null, text: "", y: clampY(y) };
        feedback("light");
        renderCaptions();
    }
    function editCaption(id) {
        const caption = captions.find((item) => item.id === id);
        if (!caption || isBusy()) return;
        commitCaption();
        editing = { id, text: caption.text, y: caption.y };
        feedback("light");
        renderCaptions();
    }
    // Fold the editor back into the list; an emptied caption is deleted.
    function commitCaption() {
        if (!editing) return;
        const text = editing.text.replace(/\s+/g, " ").trim().slice(0, CAPTION_LIMIT);
        const current = editing;
        editing = null;
        if (current.id !== null) {
            const index = captions.findIndex((item) => item.id === current.id);
            if (index >= 0) {
                if (text) captions[index] = { ...captions[index], text, y: current.y };
                else captions.splice(index, 1);
            }
        } else if (text && captions.length < MAX_CAPTIONS) {
            captions.push({ id: nextCaptionId++, text, y: current.y });
        }
        onChange();
    }
    function finishCaption() {
        const editor = captionLayer.querySelector(".review-caption-editor");
        const hadFocus = editor && document.activeElement === editor;
        commitCaption();
        renderCaptions();
        // Keyboard users continue from the caption tool rather than the page top.
        if (hadFocus && !keyboardCaption) document.activeElement?.blur?.();
        else if (hadFocus) toolColumn.querySelector("[data-photo-text]")?.focus({ preventScroll: true });
        keyboardCaption = false;
    }

    // Stage gestures: tap for a caption, swipe for a filter, two fingers to zoom.
    stage.addEventListener("pointerdown", (event) => {
        if (!mode || event.target.closest(".review-caption") || isBusy()) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        try { stage.setPointerCapture(event.pointerId); } catch (_) { /* synthetic pointers */ }
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, wasEditing: Boolean(editing) });
        if (drawing && mode === "photo") {
            if (pointers.size === 1) {
                activeStroke = { points: [strokePoint(event)], color: drawColor, width: drawWidth / Math.max(1, stage.clientWidth) };
                renderStrokes();
            }
            return;
        }
        if (pointers.size === 2 && mode === "photo") beginPinch();
        else if (pointers.size > 2) gesture = gesture?.type === "pinch" ? gesture : null;
    });
    stage.addEventListener("pointermove", (event) => {
        const point = pointers.get(event.pointerId);
        if (!point) return;
        point.x = event.clientX; point.y = event.clientY;
        if (drawing && activeStroke && pointers.size === 1) {
            activeStroke.points.push(strokePoint(event));
            renderStrokes();
            return;
        }
        if (gesture?.type === "pinch" && pointers.size === 2) {
            const state = pinchState();
            const turned = Math.atan2(Math.sin(state.angle - gesture.start.angle), Math.cos(state.angle - gesture.start.angle));
            updatePinch(state.distance / Math.max(1, gesture.start.distance), turned, state.x, state.y);
        }
    });
    function endStagePointer(event) {
        const point = pointers.get(event.pointerId);
        if (!point) return;
        pointers.delete(event.pointerId);
        if (drawing) {
            if (activeStroke && !pointers.size) {
                if (event.type !== "pointercancel" || activeStroke.points.length > 1) strokes.push(activeStroke);
                activeStroke = null;
                renderStrokes();
                renderDrawTools();
                onChange();
            }
            return;
        }
        if (gesture?.type === "pinch") {
            if (pointers.size === 2) beginPinch();
            else if (pointers.size < 2) endPinch();
            return;
        }
        if (pointers.size || event.type === "pointercancel") return;
        const dx = event.clientX - point.startX, dy = event.clientY - point.startY;
        if (performance.now() - lastPinchAt < 350) return;
        if (mode === "photo" && Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.35) {
            if (editing) finishCaption();
            cycleFilter(dx < 0 ? 1 : -1);
            return;
        }
        if (Math.hypot(dx, dy) > TAP_TOLERANCE) return;
        // Tapping outside an open caption only commits it (its blur may already have).
        if (editing || point.wasEditing) { if (editing) finishCaption(); return; }
        const bounds = stage.getBoundingClientRect();
        beginCaption((event.clientY - bounds.top) / Math.max(1, bounds.height));
    }
    stage.addEventListener("pointerup", endStagePointer);
    stage.addEventListener("pointercancel", endStagePointer);
    // Trackpad pinch arrives as ctrl+wheel in Chromium and Safari.
    stage.addEventListener("wheel", (event) => {
        if (mode !== "photo" || drawing || !event.ctrlKey) return;
        event.preventDefault();
        const bounds = stage.getBoundingClientRect();
        if (!gesture) {
            gesture = { type: "pinch", before: { ...transform }, slack: null, wheel: true, start: { scale: transform.scale, rotation: transform.rotation, anchor: photoPoint(event.clientX - bounds.left, event.clientY - bounds.top, transform, stageSize()) }, magnification: 1 };
        }
        gesture.magnification *= Math.exp(-event.deltaY / 200);
        updatePinch(gesture.magnification, 0, event.clientX - bounds.left, event.clientY - bounds.top);
        clearTimeout(gesture.timer);
        gesture.timer = setTimeout(endPinch, 250);
    }, { passive: false });
    photoCanvas.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight") { event.preventDefault(); cycleFilter(1); }
        if (event.key === "ArrowLeft") { event.preventDefault(); cycleFilter(-1); }
    });

    function clearStage() {
        stage.remove();
        for (const node of [...captionLayer.children]) node.remove();
        stage.querySelector(".review-duration").hidden = true;
        stage.querySelector("video")?.remove();
    }
    function resetState() {
        mode = null;
        if (graded && graded !== display) graded.width = graded.height = 0;
        if (display && display !== photo) display.width = display.height = 0;
        photo = display = graded = null;
        filterIndex = 0;
        transform = identity();
        history = [];
        guides = { v: false, h: false };
        strokes = [];
        activeStroke = null;
        drawing = false;
        drawWidth = 5;
        drawColor = DRAWING_COLORS[0][1];
        captions = [];
        editing = null;
        gesture = null;
        pointers.clear();
        stage.classList.remove("is-video", "is-drawing");
        renderDrawTools();
        undoZoomButton.hidden = true;
    }

    return {
        stage,
        get mode() { return mode; },
        async loadPhoto(canvas) {
            resetState();
            clearStage();
            mode = "photo";
            photo = canvas;
            aspect = canvas.width / canvas.height;
            const scale = Math.min(1, DISPLAY_MAX / Math.max(canvas.width, canvas.height));
            display = scale < 1 ? drawScaled(canvas, { x: 0, y: 0, width: canvas.width, height: canvas.height }, canvas.width * scale, canvas.height * scale) : canvas;
            graded = display;
            photoCanvas.hidden = false;
            drawingCanvas.hidden = false;
            preview.replaceChildren(stage);
            drawButton.hidden = false;
            layout();
            if (!filtersLoaded) {
                filtersLoaded = true;
                filters = await loadReviewFilters(api);
            }
        },
        loadVideo(url, { durationMs = null } = {}) {
            resetState();
            clearStage();
            mode = "video";
            stage.classList.add("is-video");
            photoCanvas.hidden = true;
            drawingCanvas.hidden = true;
            const video = document.createElement("video");
            video.src = url;
            video.muted = true;
            video.loop = true;
            video.autoplay = true;
            video.playsInline = true;
            video.controls = true;
            video.setAttribute("aria-label", "Video preview");
            stage.prepend(video);
            aspect = 3 / 4;
            video.addEventListener("loadedmetadata", () => {
                if (video.videoWidth && video.videoHeight) { aspect = video.videoWidth / video.videoHeight; layout(); }
            }, { once: true });
            if (Number(durationMs) > 0) {
                const pill = stage.querySelector(".review-duration");
                pill.textContent = `${(Number(durationMs) / 1000).toFixed(1)}s`;
                pill.hidden = false;
            }
            preview.replaceChildren(stage);
            drawButton.hidden = true;
            layout();
            void video.play?.().catch(() => {});
        },
        reset() { resetState(); clearStage(); },
        beginCaption,
        finishCaption,
        cycleFilter,
        setDrawing,
        get filter() { return filters[filterIndex]; },
        get filters() { return filters; },
        get captions() { return captions.map(({ text, y }) => ({ text, y })); },
        get strokes() { return strokes.slice(); },
        get transform() { return { ...transform }; },
        hasPhotoEdits() { return mode === "photo" && (filterIndex !== 0 || strokes.length > 0 || !isIdentity(transform)); },
        // The captions as media_text_overlay: the first at the top level,
        // every caption in `overlays` when there is more than one (iOS shape).
        textOverlay() {
            if (editing) commitCaption();
            renderCaptions();
            const items = captions.map(({ text, y }) => ({ text, x: 0.5, y: Math.round(y * 1000) / 1000 }));
            if (!items.length) return null;
            return items.length > 1 ? { ...items[0], overlays: items } : items[0];
        },
        // Everything that is burned in, at the photo's full resolution.
        compose({ drawExtras = null } = {}) {
            if (mode !== "photo" || !photo) throw new Error("Choose a photo to send.");
            const width = photo.width, height = photo.height;
            const filter = filters[filterIndex];
            const output = document.createElement("canvas");
            output.width = width;
            output.height = height;
            const context = output.getContext("2d", { alpha: false });
            if (isIdentity(transform)) {
                context.drawImage(photo, 0, 0);
                applyReviewFilter(output, filter);
            } else {
                let source = photo;
                if (filter && filter.id !== "none") {
                    source = drawScaled(photo, { x: 0, y: 0, width, height }, width, height);
                    applyReviewFilter(source, filter);
                }
                drawTransformed(context, source, width, height, transform);
                if (source !== photo) source.width = source.height = 0;
            }
            drawStrokes(context, strokes, width, height);
            drawExtras?.(context, width, height);
            return output;
        },
    };
}
