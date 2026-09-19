// The backend owns call lifecycle and history. Match ChatCallHistoryCard labels;
// never infer a completed call or manufacture a chat message on the client.
export function callHistoryPresentation(message, viewerId) {
    const mine = message.viewer_is_sender || String(message.sender_user_id) === String(viewerId);
    const media = message.call_media_type === 'video' ? 'video' : 'voice';
    const label = media === 'video' ? 'Video' : 'Voice';
    const direction = mine ? 'Outgoing' : 'Incoming';
    const missed = message.call_viewer_state === 'missed' || (message.call_state === 'missed' && !mine);
    let title;
    if (message.call_viewer_state === 'declined') title = 'You declined';
    else if (missed) title = `Missed ${media} call`;
    else if (message.call_viewer_state === 'invited') title = `Incoming ${media} call`;
    else title = {
        ringing: `${direction} ${media} call`, active: `${label} call in progress`,
        missed: mine ? 'No answer' : 'Missed call', declined: mine ? 'Call declined' : 'You declined',
        cancelled: `Cancelled ${media} call`, failed: 'Call failed', ended: `${label} call`,
    }[message.call_state] || message.body || `${label} call`;
    let detail = direction;
    if (message.call_state === 'ended') {
        const start = mine ? message.call_answered_at : message.call_viewer_answered_at || message.call_answered_at;
        const end = message.call_viewer_left_at || message.call_ended_at;
        const elapsed = start && end ? (Date.parse(end) - Date.parse(start)) / 1000 : NaN;
        if (Number.isFinite(elapsed)) {
            const seconds = Math.max(0, Math.round(elapsed));
            detail += ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        }
    }
    return { title, detail, mine: !!mine, icon: media === 'video' ? 'video' : 'phone', attention: missed || message.call_state === 'failed' };
}
