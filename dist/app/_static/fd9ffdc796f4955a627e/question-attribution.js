// What one viewer's "Question submitted by" row shows. Mirrors iOS
// QuestionSubmitterAttribution (Six7Core): an anonymous question reads
// "Someone at your school" to everyone, its author included. The server sends
// the author their own name for their anonymous questions (marked revealed),
// which made people think their questions weren't anonymous; the author gets a
// private hint instead. A God Mode reveal by someone else still shows that
// viewer the name, and named questions are unchanged.

export const ANONYMOUS_SUBMITTER_NAME = "Someone at your school";
export const AUTHOR_ANONYMITY_HINT = "Only you know you asked this";

/**
 * @returns {{ kind: "none" } | { kind: "named", name: string } | { kind: "anonymous", viewerIsAuthor: boolean }}
 */
export function resolveQuestionAttribution({ showsAttribution, isAnonymous, identityRevealed = false, submitterName = null, submitterUserId = null, viewerUserId = null }) {
    if (!showsAttribution) return { kind: "none" };
    const viewerIsAuthor = viewerUserId != null && submitterUserId != null && String(submitterUserId) === String(viewerUserId);
    if (isAnonymous && viewerIsAuthor) return { kind: "anonymous", viewerIsAuthor: true };
    const name = String(submitterName ?? "").trim();
    if ((!isAnonymous || identityRevealed) && name) return { kind: "named", name };
    return { kind: "anonymous", viewerIsAuthor: false };
}

/** A Play question from GET /questions/unanswered. Web Play offers no reveal. */
export function playQuestionAttribution(question, viewerUserId) {
    return resolveQuestionAttribution({
        showsAttribution: Boolean(question?.is_user_submitted),
        isAnonymous: Boolean(question?.is_anonymous),
        identityRevealed: false,
        submitterName: question?.submitted_by_name,
        submitterUserId: question?.submitted_by_user_id,
        viewerUserId,
    });
}

/** A feed or inbox row's question, from the feed payload. */
export function feedQuestionAttribution(item, viewerUserId) {
    return resolveQuestionAttribution({
        showsAttribution: item?.question_school_id != null && item?.question_is_user_submitted !== false,
        isAnonymous: item?.question_is_anonymous ?? !String(item?.question_submitted_by_display_name ?? "").trim(),
        identityRevealed: Boolean(item?.question_submitter_revealed),
        submitterName: item?.question_submitted_by_display_name,
        submitterUserId: item?.question_submitted_by_user_id,
        viewerUserId,
    });
}
