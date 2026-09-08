import { setRuntimeStyles } from '../runtime-style.js';

export function createPhotoStickers(preview, { onChange, disabled }) {
    let items = [], generation = 0, pendingAdds = 0, selected = null;
    const removeButton = document.createElement('button');
    removeButton.type = 'button'; removeButton.className = 'chat-photo-sticker-remove';
    removeButton.textContent = '×'; removeButton.setAttribute('aria-label', 'Remove selected sticker');
    function remove(item) {
        items = items.filter(i => i !== item); item.node.remove(); item.bitmap.close(); URL.revokeObjectURL(item.url);
        if (selected === item) selected = null;
        mount(); onChange();
    }
    removeButton.addEventListener('click', () => { if (selected && !disabled()) remove(selected); });
    function bounds() {
        const image = preview.querySelector(':scope > img');
        if (!image?.naturalWidth) return null;
        const width = preview.clientWidth, height = preview.clientHeight;
        const ratio = Math.min(width / image.naturalWidth, height / image.naturalHeight);
        const w = image.naturalWidth * ratio, h = image.naturalHeight * ratio;
        return { x: (width - w) / 2, y: (height - h) / 2, w, h };
    }
    function mount() {
        const rect = bounds(); if (!rect) return;
        for (const item of items) {
            if (!item.node.isConnected) preview.append(item.node);
            setRuntimeStyles(item.node, { left: `${rect.x + rect.w * item.x}px`, top: `${rect.y + rect.h * item.y}px`, width: `${rect.w * item.scale}px` });
        }
        if (selected) {
            if (!removeButton.isConnected) preview.append(removeButton);
            setRuntimeStyles(removeButton, { left: `${Math.min(rect.x + rect.w - 44, Math.max(rect.x, rect.x + rect.w * (selected.x + selected.scale / 2) - 22))}px`, top: `${Math.max(rect.y + 60, rect.y + rect.h * selected.y - rect.w * selected.scale * selected.bitmap.height / selected.bitmap.width / 2 - 22)}px` });
        } else removeButton.remove();
    }
    new ResizeObserver(mount).observe(preview);
    preview.addEventListener('load', mount, true);
    async function add(url) {
        if (disabled() || items.length + pendingAdds >= 8) throw new Error('Use up to eight stickers per photo.');
        pendingAdds++;
        try {
        const current = generation;
        const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(15000) });
        if (!response.ok || !response.body) throw new Error('Could not load that sticker.');
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
            while (true) { const { done, value } = await reader.read(); if (done) break;
                size += value.length; if (size > 2 * 1024 * 1024) throw new Error('That sticker is too large.'); chunks.push(value); }
        } finally { await reader.cancel().catch(() => {}); }
        const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'image/png' });
        const bitmap = await createImageBitmap(blob);
        if (current !== generation || disabled()) { bitmap.close(); return; }
        if (bitmap.width * bitmap.height > 2048 * 2048) { bitmap.close(); throw new Error('That sticker is too large.'); }
        const node = document.createElement('button'), image = document.createElement('img');
        node.type = 'button'; node.className = 'chat-photo-sticker'; node.setAttribute('aria-label', 'Move sticker; arrow keys move, plus or minus resize, Delete removes');
        image.src = URL.createObjectURL(blob); image.alt = ''; image.draggable = false; node.append(image);
        const item = { node, bitmap, url: image.src, x: .5, y: .5, scale: .28 }; items.push(item);
        const pointers = new Map(); let pinchDistance = 0, pinchScale = item.scale;
        const distance = () => { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
        node.addEventListener('pointerdown', event => {
            if (disabled() || pointers.size >= 2) return;
            event.preventDefault(); event.stopPropagation(); selected = item;
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); node.setPointerCapture(event.pointerId);
            pinchDistance = distance(); pinchScale = item.scale; mount();
        });
        node.addEventListener('pointermove', event => {
            if (!pointers.has(event.pointerId) || disabled()) return;
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.size === 2) {
                if (pinchDistance > 0) item.scale = Math.max(.1, Math.min(.8, pinchScale * distance() / pinchDistance));
                mount(); onChange(); return;
            }
            const rect = bounds(), box = preview.getBoundingClientRect(); if (!rect) return;
            item.x = Math.max(0, Math.min(1, (event.clientX - box.left - rect.x) / rect.w));
            item.y = Math.max(0, Math.min(1, (event.clientY - box.top - rect.y) / rect.h)); mount(); onChange();
        });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) node.addEventListener(type, event => { pointers.delete(event.pointerId); });
        node.addEventListener('focus', () => { selected = item; mount(); });
        node.addEventListener('keydown', event => {
            if (disabled() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Delete', 'Backspace'].includes(event.key)) return;
            event.preventDefault();
            if (['Delete', 'Backspace'].includes(event.key)) { remove(item); return; }
            else { item.x = Math.max(0, Math.min(1, item.x + (event.key === 'ArrowRight' ? .03 : event.key === 'ArrowLeft' ? -.03 : 0)));
                item.y = Math.max(0, Math.min(1, item.y + (event.key === 'ArrowDown' ? .03 : event.key === 'ArrowUp' ? -.03 : 0)));
                item.scale = Math.max(.1, Math.min(.8, item.scale + (['+', '='].includes(event.key) ? .04 : event.key === '-' ? -.04 : 0))); mount(); }
            onChange();
        });
        selected = item; mount(); onChange();
        } finally { pendingAdds--; }
    }
    async function bake(file) {
        if (!items.length) return file;
        const current = generation;
        const image = await createImageBitmap(file);
        try {
            if (generation !== current) throw new Error('Photo was closed. Choose it again.');
            const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
            for (const item of items) { const w = image.width * item.scale, h = w * item.bitmap.height / item.bitmap.width;
                ctx.drawImage(item.bitmap, image.width * item.x - w / 2, image.height * item.y - h / 2, w, h); }
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
            if (!blob || blob.size > 8 * 1024 * 1024) throw new Error('That photo is too large to send.');
            return new File([blob], 'chat-photo.jpg', { type: 'image/jpeg' });
        } finally { image.close(); }
    }
    function reset() { generation++; for (const i of items) { i.node.remove(); i.bitmap.close(); URL.revokeObjectURL(i.url); } items = []; selected = null; removeButton.remove(); }
    return { add, bake, reset, mount };
}
