import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneVerificationDeadline } from '../../app/phone-verification.js';

const server = Date.parse('2026-09-18T12:00:00Z');
const header = new Date(server).toUTCString();
const approved = { is_approved: true, expires_at: new Date(server + 120_000).toISOString() };

test('server-relative expiry tolerates device clocks years ahead or behind', () => {
    for (const now of [server - 10_000_000_000, server + 50_000_000_000]) {
        assert.equal(phoneVerificationDeadline(approved, header, { now, elapsedMs: 250 }), now + 118_750);
    }
});

test('reused approval keeps only its remaining lifetime instead of a fresh TTL', () => {
    const later = new Date(server + 110_000).toUTCString();
    assert.equal(phoneVerificationDeadline({ ...approved, last_check_at: new Date(server).toISOString() }, later, { now: 1000 }), 10_000);
});

test('expired approvals and responses longer than the lifetime expire immediately', () => {
    assert.equal(phoneVerificationDeadline(approved, new Date(server + 121_000).toUTCString(), { now: 1000 }), 1000);
    assert.equal(phoneVerificationDeadline(approved, header, { now: 1000, elapsedMs: 120_000 }), 1000);
});

test('missing or invalid server timing preserves backend-driven recovery', () => {
    for (const date of [null, undefined, '', 'invalid']) assert.equal(phoneVerificationDeadline(approved, date), null);
    for (const expires_at of [null, undefined, '', 'invalid']) {
        assert.equal(phoneVerificationDeadline({ ...approved, expires_at }, header), null);
    }
});

test('unapproved verification and invalid duration never become a deadline', () => {
    assert.equal(phoneVerificationDeadline({ ...approved, is_approved: false }, header), null);
    for (const elapsedMs of [-1, NaN, Infinity]) assert.equal(phoneVerificationDeadline(approved, header, { elapsedMs }), null);
});
