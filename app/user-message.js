// Plain-English error messages for people, not developers.
//
//   import { userMessage } from "./user-message.js";
//   catch (error) { status.textContent = userMessage(error, "Could not save your bio."); }
//
// Server-authored `detail` sentences ("That username is taken.") are kept.
// Status codes, browser DOMExceptions, network failures, and developer text
// ("Request failed (500)", "Cannot read properties of undefined") become a
// plain sentence, or the caller's `fallback`.

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

const OFFLINE = "You’re offline. Reconnect, then try again.";
const UNREACHABLE = "Could not reach Valid. Check your connection and try again.";
const TIMEOUT = "That took too long. Check your connection and try again.";

const STATUS_MESSAGES = {
    401: "Your session expired. Sign in again to continue.",
    403: "You don’t have permission to do that.",
    404: "That’s no longer available.",
    409: "That changed somewhere else. Refresh and try again.",
    413: "That file is too large. Choose a smaller one.",
    415: "That file type isn’t supported. Choose a photo or video.",
    429: "Too many requests. Please try again shortly.",
};
const SERVER_ERROR = "Valid is having trouble right now. Please try again in a moment.";

// Browser and media errors are identified by name, never by their (English-only, technical) message.
const DOM_EXCEPTION_MESSAGES = {
    NotAllowedError: "Permission was denied. Allow access in your browser settings, then try again.",
    NotReadableError: "Your camera or microphone is being used by another app. Close it, then try again.",
    NotFoundError: "No camera or microphone was found on this device.",
    OverconstrainedError: "Your camera doesn’t support that setting.",
    NotSupportedError: "This browser doesn’t support that yet.",
    SecurityError: "Your browser blocked that for security reasons.",
    QuotaExceededError: "Your device is out of storage for Valid. Free up some space and try again.",
    AbortError: "That was cancelled.",
    TimeoutError: TIMEOUT,
    NetworkError: UNREACHABLE,
    InvalidStateError: "That isn’t available right now. Please try again.",
    EncodingError: "That file couldn’t be read. Try a different one.",
};

const TECHNICAL = [
    /<!doctype|<html|<body|<head/i,
    /^request failed\b/i,
    /^failed to fetch$/i,
    /^load failed$/i,
    /^networkerror\b/i,
    /network ?error when attempting to fetch/i,
    /\b(undefined|null) is not\b|is not a function|cannot read propert|unexpected token|is not defined|json\.parse|syntaxerror|typeerror/i,
    /^[A-Z0-9_]+$/, // ERROR_CODE
    /^[a-z0-9]+(_[a-z0-9]+)+$/, // snake_case_code
    /^\{|^\[/,
];

function isNetworkFailure(error) {
    const message = String(error?.message || "");
    return error?.name === "TypeError" && /fetch|load failed|network/i.test(message);
}

/** True when text reads like a sentence written for a person. */
export function isHumanSentence(text) {
    const value = String(text ?? "").trim();
    if (!value || value.length > 240 || !/\s/.test(value)) return false;
    if (TECHNICAL.some((pattern) => pattern.test(value))) return false;
    return /^[\p{Lu}\p{N}"“‘'(¿¡]/u.test(value) || /^[\p{Emoji_Presentation}]/u.test(value);
}

function statusMessage(status, text, fallback) {
    if (status === 0) return text && isHumanSentence(text) ? text : (typeof navigator !== "undefined" && navigator.onLine === false ? OFFLINE : UNREACHABLE);
    if (status === 408) return TIMEOUT;
    if (status >= 500) return SERVER_ERROR;
    if (status === 429 && /try again/i.test(text)) return text; // api.js already wrote the retry time
    if (isHumanSentence(text)) return text;
    return STATUS_MESSAGES[status] || fallback;
}

/**
 * A message safe to show a person for any thrown value.
 * @param {unknown} error an APIError, DOMException, Error, or string
 * @param {string} [fallback] shown when nothing better is known
 */
export function userMessage(error, fallback = GENERIC_ERROR_MESSAGE) {
    if (error == null) return fallback;
    if (typeof error === "string") return isHumanSentence(error) ? error.trim() : fallback;
    const text = String(error.message || "").trim();
    const status = Number.isInteger(error.status) ? error.status : null;
    if (status !== null && error.name === "APIError") return statusMessage(status, text, fallback);
    if (isNetworkFailure(error)) return typeof navigator !== "undefined" && navigator.onLine === false ? OFFLINE : UNREACHABLE;
    const named = DOM_EXCEPTION_MESSAGES[error.name];
    const browserException = (typeof DOMException !== "undefined" && error instanceof DOMException) || error.name === "OverconstrainedError";
    // A browser's own exception text is technical; an app error that borrowed the name may carry a real sentence.
    if (named && (browserException || !isHumanSentence(text))) return named;
    if (status !== null) return statusMessage(status, text, fallback);
    return isHumanSentence(text) ? text : fallback;
}

function fieldLabel(location) {
    const field = [...(Array.isArray(location) ? location : [])].reverse().find((part) => typeof part === "string" && !["body", "query", "path", "header"].includes(part));
    if (!field) return "";
    const words = field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
    return words ? words[0].toUpperCase() + words.slice(1) : "";
}

function sentence(text) {
    const value = String(text || "").trim();
    return !value || /[.!?]$/.test(value) ? value : `${value}.`;
}

/**
 * FastAPI/Pydantic 422 `detail` arrays → one readable sentence about the
 * first invalid field, e.g. "Username must be at least 3 characters."
 */
export function validationMessage(detail) {
    const issue = Array.isArray(detail) ? detail.find((item) => item && typeof item === "object") : null;
    if (!issue) return "";
    const label = fieldLabel(issue.loc);
    const raw = String(issue.msg || "").replace(/^Value error,\s*/i, "").replace(/^Assertion failed,\s*/i, "").trim();
    const subject = label || "This field";
    let match;
    if (/^field required$/i.test(raw) || issue.type === "missing") return `${subject} is required.`;
    if ((match = raw.match(/^String should have at least (\d+) characters?$/i))) return `${subject} must be at least ${match[1]} character${match[1] === "1" ? "" : "s"}.`;
    if ((match = raw.match(/^String should have at most (\d+) characters?$/i))) return `${subject} must be ${match[1]} character${match[1] === "1" ? "" : "s"} or fewer.`;
    if ((match = raw.match(/^(?:List|Value) should have at most (\d+) items?/i))) return `${subject} can have at most ${match[1]}.`;
    if (/^String should match pattern/i.test(raw)) return `${subject} has characters that aren’t allowed.`;
    if (/^Input should be a valid (integer|number)/i.test(raw)) return `${subject} must be a number.`;
    if (/^Input should be a valid email|not a valid email/i.test(raw)) return `${subject} must be a valid email address.`;
    if (/^Input should be/i.test(raw)) return `${subject} isn’t valid.`;
    if (isHumanSentence(raw)) return sentence(label && issue.type !== "value_error" ? `${label}: ${raw[0].toLowerCase()}${raw.slice(1)}` : raw);
    return label ? `${label} isn’t valid.` : "Some details aren’t valid. Check them and try again.";
}
