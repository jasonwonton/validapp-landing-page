import { CHAT_REACTIONS, escapeChatHTML, messageTime } from './models.js';
import { canSaveMessage } from './history.js';
import { uiIcon } from '../ui-icons.js';
import { setRuntimeStyles } from '../runtime-style.js';

export function messageActionsMarkup(message, { mine, olderReaders }) {
    const id = escapeChatHTML(message.id);
    const sent = message.delivery_state === 'sent';
    const copy = message.kind === 'text' && message.body?.trim();
    const button = (action, label, icon, extra = '') => `<button type="button" data-${action}-message="${id}" ${extra}>${uiIcon(icon)} ${label}</button>`;
    return `<dialog class="chat-message-actions" aria-label="Message actions">
        ${sent ? `<div class="chat-reaction-picker">${CHAT_REACTIONS.map(([type, emoji]) => `<button type="button" aria-label="React ${type}" aria-pressed="${message.current_user_reaction === type}" data-react-message="${id}" data-reaction="${type}" class="${message.current_user_reaction === type ? 'active' : ''}">${emoji}</button>`).join('')}</div>` : ''}
        ${sent ? '<hr>' : ''}
        ${copy || sent ? `<div class="chat-action-pair">${copy ? button('copy', 'Copy', 'copy') : ''}${sent ? button('reply', 'Reply', 'reply') : ''}</div>` : ''}
        ${sent ? `<hr>${button('delete', 'Delete for me', 'trash', 'class="danger"')}` : ''}
        ${canSaveMessage(message) ? `<button type="button" class="chat-save-action" data-save-message="${id}" aria-label="${message.saved_in_chat ? 'Unsave' : 'Save in chat'}"><span>${uiIcon(message.saved_in_chat ? 'bookmark-slash' : 'bookmark')} ${message.saved_in_chat ? 'Unsave' : 'Save in chat'}</span><small>${message.saved_in_chat ? 'Use this chat’s clearing setting' : 'Keep for everyone in this chat'}</small></button>` : ''}
        ${mine && sent && message.kind !== 'memento' ? button('unsend', 'Unsend for everyone', 'trash-filled', 'class="danger"') : ''}
        <footer class="chat-action-footer"><time class="chat-action-time">${escapeChatHTML(messageTime(message.created_at))}</time>${olderReaders ? `<button type="button" data-view-readers="${id}">Read receipts</button>` : ''}</footer>
    </dialog>`;
}

// Native gesture policy: 360 ms hold, at most 10 points of movement. Dialogs
// live in the browser top layer so the scrolling timeline cannot clip them.
export function bindMessageActions(root, { onOpen } = {}) {
    let pending = null;
    let active = null;
    let suppressClickUntil = 0;
    const cancelHold = () => { clearTimeout(pending?.timer); pending = null; };
    const reset = message => {
        message?.classList.remove('actions-open');
        message?.querySelector('[data-message-menu]')?.setAttribute('aria-expanded', 'false');
    };
    function close() {
        cancelHold();
        if (!active) return;
        const dialog = active; active = null;
        reset(dialog.closest('.chat-message'));
        if (dialog.open) dialog.close();
    }
    function toggle(id, forceOpen = null, point = null) {
        const message = root.querySelector(`[data-message-id="${CSS.escape(String(id))}"]`);
        const dialog = message?.querySelector('.chat-message-actions');
        if (!dialog) return;
        const shouldOpen = forceOpen ?? !dialog.open;
        close();
        if (!shouldOpen) return;
        const bubble = message.querySelector('.chat-bubble').getBoundingClientRect();
        point ||= { x: bubble.x + bubble.width / 2, y: bubble.y + bubble.height / 2 };
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
        const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
        setRuntimeStyles(dialog, { '--chat-actions-width': `${Math.min(320, width - 24)}px`, '--chat-actions-height': `${height - 24}px` });
        active = dialog;
        dialog.showModal();
        // offset sizes exclude the opening scale animation.
        const w = dialog.offsetWidth, h = dialog.offsetHeight;
        const above = point.y - top - 22, below = top + height - point.y - 22;
        const y = above >= h || above > below ? point.y - h - 10 : point.y + 10;
        setRuntimeStyles(dialog, {
            '--chat-actions-left': `${Math.max(left + 12, Math.min(point.x - w / 2, left + width - w - 12))}px`,
            '--chat-actions-top': `${Math.max(top + 12, Math.min(y, top + height - h - 12))}px`,
        });
        message.classList.add('actions-open');
        message.querySelector('[data-message-menu]')?.setAttribute('aria-expanded', 'true');
        onOpen?.();
    }
    root.addEventListener('pointerdown', event => {
        suppressClickUntil = 0;
        cancelHold();
        if (!event.isPrimary || event.button !== 0 || event.target.closest('.chat-message-actions, [data-message-menu], [data-replay], audio, input, textarea, .chat-reply-preview')) return;
        const bubble = event.target.closest('[data-message-bubble]');
        if (!bubble) return;
        const point = { x: event.clientX, y: event.clientY };
        pending = { ...point, pointerId: event.pointerId, timer: setTimeout(() => {
            pending = null;
            if (!bubble.isConnected) return;
            toggle(bubble.dataset.messageBubble, true, point);
            suppressClickUntil = Infinity;
        }, 360) };
    });
    root.addEventListener('pointermove', event => {
        if (pending && (event.pointerId !== pending.pointerId || Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 10)) cancelHold();
    });
    for (const name of ['pointerup', 'pointercancel', 'pointerleave']) root.addEventListener(name, cancelHold);
    root.addEventListener('pointerup', () => {
        if (suppressClickUntil === Infinity) suppressClickUntil = performance.now() + 200;
    });
    root.querySelector('.chat-timeline')?.addEventListener('scroll', cancelHold, { passive: true });
    root.addEventListener('click', event => {
        if (performance.now() < suppressClickUntil) {
            suppressClickUntil = 0;
            event.preventDefault(); event.stopImmediatePropagation(); return;
        }
        if (event.target === active) {
            const box = active.getBoundingClientRect();
            if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
        }
    }, true);
    root.addEventListener('contextmenu', event => {
        const bubble = event.target.closest('[data-message-bubble]');
        if (!bubble || event.target.closest('[data-replay], audio, input, textarea')) return;
        event.preventDefault();
        if (!active) toggle(bubble.dataset.messageBubble, true, { x: event.clientX, y: event.clientY });
        cancelHold();
    });
    root.addEventListener('keydown', event => {
        suppressClickUntil = 0;
        if (event.key !== 'Tab' || !active) return;
        const buttons = [...active.querySelectorAll('button:not(:disabled)')];
        const first = buttons[0], last = buttons.at(-1);
        if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus({ preventScroll: true });
        }
    });
    root.addEventListener('close', event => {
        if (!event.target.matches('.chat-message-actions') || event.target.open) return;
        reset(event.target.closest('.chat-message'));
        if (active === event.target) active = null;
    }, true);
    // A realtime edit can replace the keyed message while its menu is open.
    new MutationObserver(() => { if (active && !active.isConnected) close(); }).observe(root, { childList: true, subtree: true });
    window.addEventListener('resize', close);
    window.visualViewport?.addEventListener('resize', close);
    return { toggle, close };
}
