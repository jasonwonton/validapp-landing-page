import { test, expect } from '@playwright/test';
import { callHistoryPresentation } from '../app/chat/call-history.js';

test('call history uses native viewer-specific outcomes and duration', () => {
    const message = { sender_user_id: 'me', call_state: 'cancelled', call_media_type: 'audio' };
    expect(callHistoryPresentation(message, 'me')).toMatchObject({ title: 'Cancelled voice call', detail: 'Outgoing' });
    expect(callHistoryPresentation({ ...message, call_media_type: 'video' }, 'me').title).toBe('Cancelled video call');
    expect(callHistoryPresentation({ ...message, call_state: 'missed' }, 'me').title).toBe('No answer');
    expect(callHistoryPresentation({ ...message, call_state: 'missed' }, 'other')).toMatchObject({ title: 'Missed voice call', attention: true });
    expect(callHistoryPresentation({ ...message, call_viewer_state: 'declined' }, 'other').title).toBe('You declined');
    expect(callHistoryPresentation({ ...message, call_state: 'ended', call_answered_at: '2026-09-07T12:00:00Z', call_ended_at: '2026-09-07T12:02:05Z', call_viewer_answered_at: '2026-09-07T12:01:00Z' }, 'other').detail).toBe('Incoming · 1:05');
    expect(callHistoryPresentation({ ...message, call_state: 'ended' }, 'me').detail).toBe('Outgoing');
});
