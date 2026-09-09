// Shared by the browser and private gateway. Never emit arbitrary server text.
export function authStage(path) {
    return {
        '/auth/passkey/authenticate/challenge': 'signin_challenge',
        '/auth/passkey/authenticate': 'signin_complete',
        '/auth/passkey/signup/challenge': 'signup_challenge',
        '/auth/passkey/signup/complete': 'signup_complete',
        '/auth/phone/request/web': 'phone_request',
        '/auth/phone/confirm': 'phone_confirm',
        '/users/phone-check': 'phone_check',
    }[path];
}

export function authRejectionCode(status, detail) {
    const message = typeof detail === 'string' ? detail.trim().toLowerCase() : '';
    const known = {
        'invalid or expired passkey challenge': 'passkey_challenge_invalid',
        'invalid passkey registration': 'passkey_registration_invalid',
        'invalid passkey response': 'passkey_response_invalid',
        'phone number is not verified.': 'phone_not_verified',
        'phone verification has expired. request a new code.': 'phone_verification_expired',
        'verification code has expired. request a new code.': 'phone_verification_expired',
        'invalid or expired verification code.': 'phone_code_invalid',
        'invalid web signup origin': 'signup_origin_rejected',
        'choose a school to create an account.': 'school_required',
        'choose a gender to create an account.': 'gender_required',
        'an account already exists for this phone number. sign in instead.': 'account_exists',
        'that username is already taken.': 'username_taken',
    };
    return Object.hasOwn(known, message) ? known[message] : (status === 429 ? 'rate_limited' : status === 422 ? 'validation_rejected'
        : status === 409 ? 'identity_conflict' : status >= 500 ? 'server_error' : 'auth_request_rejected');
}

export function authDeviceFamily(ua = '') {
    const browser = /SamsungBrowser/i.test(ua) ? 'samsung_internet' : /; wv\)|Instagram|FBAN|FBAV/i.test(ua) ? 'embedded'
        : /Firefox/i.test(ua) ? 'firefox' : /Chrome/i.test(ua) ? 'chrome' : /Safari/i.test(ua) ? 'safari' : 'other';
    return `${/Android/i.test(ua) ? 'android' : /iPhone|iPad/i.test(ua) ? 'ios_web' : 'desktop'}_${browser}`;
}
