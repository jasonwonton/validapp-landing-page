export function viewOncePresentation(message, { canReplay = false, armed = false, loading = false, failed = false } = {}) {
    const mine = message.viewer_is_sender;
    const opened = Number(message.view_once_opened_count || 0);
    const total = Number(message.view_once_recipient_count || 0);
    const remaining = message.view_once_remaining_views == null ? 2 : Number(message.view_once_remaining_views);
    const consumed = message.view_once_consumed === true || remaining === 0 || (remaining === 1 && !canReplay);
    const expired = !mine && message.view_once_available === false && !consumed;
    let label;
    if (mine) {
        const name = message.view_once_first_opener_first_name;
        label = !opened && !message.view_once_consumed ? 'Delivered'
            : total > 1 && opened >= total ? 'Opened by everyone'
            : name ? opened > 1 ? `${name} + ${opened - 1}` : `Opened by ${name}`
            : opened > 1 ? `Opened by ${opened}` : 'Opened';
    } else label = expired ? 'Expired' : consumed ? 'Opened' : loading ? 'Loading…' : failed ? 'Try again'
        : remaining === 1 ? armed ? 'Tap to replay' : 'Hold to replay' : 'Tap to view';
    return { label, disabled: !!mine || consumed || expired || loading, replay: !mine && remaining === 1 && !consumed && !expired,
        hollow: mine ? !!message.view_once_consumed : consumed || remaining === 1,
        kind: message.kind === 'video' ? 'video' : 'photo', mine: !!mine, expired };
}
