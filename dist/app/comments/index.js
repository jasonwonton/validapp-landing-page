const ROOT_PAGE_SIZE = 30;
const REPLY_PAGE_SIZE = 50;
const REACTOR_PAGE_SIZE = 50;
const MAX_ROOTS = 100;
const MAX_REPLIES_PER_ROOT = 100;
const MAX_REACTORS = 100;

const REACTIONS = [
    { type: "thumbs_down", emoji: "👎", label: "Thumbs Down" },
    { type: "surprised", emoji: "😮", label: "Surprised" },
    { type: "fire", emoji: "🔥", label: "Fire" },
    { type: "eyes", emoji: "👀", label: "Interesting" },
    { type: "funny", emoji: "😂", label: "Funny" },
    { type: "love", emoji: "❤️", label: "Love" },
];
const REACTION_BY_TYPE = new Map(REACTIONS.map((reaction) => [reaction.type, reaction]));

function newRequestId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(16)}-${crypto.getRandomValues(new Uint32Array(4)).join("-")}`;
}

function uniqueById(items) {
    const seen = new Set();
    return items.filter((item) => {
        const id = String(item.id ?? `${item.user_id || "row"}:${item.reaction_type || ""}`);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

export function createCommentsView(context) {
    const {
        root, api, getUser, escapeHTML, avatarMarkup, relativeTime,
        openDetailScreen, closeDetailScreen, showToast,
    } = context;

    root.innerHTML = `
        <section id="commentsDialog" class="detail-screen comments-screen hidden" role="dialog" aria-modal="true" aria-labelledby="commentsTitle">
            <div class="detail-screen-header comments-header">
                <button class="detail-back-button sheet-text-control" aria-label="Close" type="button" data-close-comments><span>Done</span></button>
                <strong id="commentsTitle">Comments</strong>
                <span></span>
            </div>
            <div class="comments-layout">
                <div id="commentsContext" class="comments-context"></div>
                <div id="commentModerationNotice" class="comment-moderation-notice hidden" role="alert"></div>
                <div id="commentsStatus" class="inline-status" role="status"></div>
                <div id="commentsList" class="comments-list" aria-live="polite"></div>
                <button id="loadMoreComments" class="secondary-button hidden" type="button">Load older comments</button>
                <form id="commentComposer" class="comment-composer">
                    <div id="commentReplyContext" class="comment-reply-context hidden"></div>
                    <label for="commentDraft" class="visually-hidden">Add a comment</label>
                    <div class="comment-composer-row">
                        <textarea id="commentDraft" rows="1" maxlength="280" placeholder="Add a comment…" required></textarea>
                        <button id="sendComment" class="primary-button" type="submit" disabled>Send</button>
                    </div>
                    <div class="comment-composer-meta"><span id="commentRestriction"></span><span id="commentCharacterCount">0/280</span></div>
                </form>
            </div>
        </section>
        <dialog id="commentReactorsDialog" class="modal comment-reactors-dialog" aria-labelledby="commentReactorsTitle">
            <div class="sheet-heading"><button class="sheet-heading-control" type="button" data-close-comment-reactors>Done</button><h2 id="commentReactorsTitle">Reactions</h2><span></span></div>
            <div id="commentReactorsList" class="comment-reactors-list"></div>
            <button id="loadMoreCommentReactors" class="secondary-button hidden" type="button">Load more</button>
        </dialog>`;

    const $ = (selector) => root.querySelector(selector);
    const dialog = $("#commentsDialog");
    const list = $("#commentsList");
    const draft = $("#commentDraft");
    const sendButton = $("#sendComment");
    const reactorsDialog = $("#commentReactorsDialog");
    let target = null;
    let roots = [];
    let replies = new Map();
    let replyHasMore = new Map();
    let hasMoreRoots = false;
    let replyingTo = null;
    let highlightedCommentId = null;
    let openReactionPickerId = null;
    let pendingCreate = null;
    let creating = false;
    const reactionBusy = new Set();
    let moderation = { notice: null, restriction: { is_restricted: false, expires_at: null } };
    let reactorState = { commentId: null, rows: [], hasMore: false, loading: false };

    function targetMethods() {
        if (target?.type === "poll") {
            return {
                list: "listPollComments", get: "getPollComment", replies: "listPollCommentReplies",
                create: "createPollComment", setReaction: "setPollCommentReaction",
                removeReaction: "removePollCommentReaction", reactors: "getPollCommentReactors",
                report: "reportPollComment", delete: "deletePollComment",
            };
        }
        return {
            list: "listFeedActivityComments", get: "getFeedActivityComment", replies: "listFeedActivityCommentReplies",
            create: "createFeedActivityComment", setReaction: "setFeedActivityCommentReaction",
            removeReaction: "removeFeedActivityCommentReaction", reactors: "getFeedActivityCommentReactors",
            report: "reportFeedActivityComment", delete: "deleteFeedActivityComment",
        };
    }

    function call(method, ...args) {
        const user = getUser();
        if (!target || !user?.id) throw new Error("Sign in to use comments.");
        return api[targetMethods()[method]](user.id, target.id, ...args);
    }

    function restrictionActive() {
        const restriction = moderation.restriction || {};
        if (!restriction.is_restricted) return false;
        if (!restriction.expires_at) return true;
        return Date.parse(restriction.expires_at) > Date.now();
    }

    function restrictionText() {
        if (!restrictionActive()) return "";
        const expires = moderation.restriction?.expires_at;
        if (!expires) return "Commenting is disabled for this account.";
        return `Commenting is paused until ${new Date(expires).toLocaleString()}.`;
    }

    function commentById(commentId) {
        const id = String(commentId);
        const rootComment = roots.find((comment) => String(comment.id) === id);
        if (rootComment) return rootComment;
        for (const values of replies.values()) {
            const reply = values.find((comment) => String(comment.id) === id);
            if (reply) return reply;
        }
        return null;
    }

    function replaceComment(updated) {
        const id = String(updated.id);
        const rootIndex = roots.findIndex((comment) => String(comment.id) === id);
        if (rootIndex >= 0) roots[rootIndex] = updated;
        for (const [rootId, values] of replies) {
            const index = values.findIndex((comment) => String(comment.id) === id);
            if (index >= 0) {
                const next = [...values];
                next[index] = updated;
                replies.set(rootId, next);
            }
        }
    }

    function renderReactionSummary(comment) {
        const entries = REACTIONS
            .map((reaction) => ({ ...reaction, count: Number(comment.reaction_summary?.[reaction.type] || 0) }))
            .filter((reaction) => reaction.count > 0);
        if (!entries.length) return "";
        return `<button class="comment-reaction-summary" type="button" data-comment-reactors="${escapeHTML(comment.id)}" aria-label="View ${Number(comment.reaction_count || 0)} reactions"><span aria-hidden="true">${entries.slice(0, 3).map((entry) => entry.emoji).join("")}</span><strong>${Number(comment.reaction_count || 0)}</strong></button>`;
    }

    function renderReactionPicker(comment) {
        if (String(openReactionPickerId) !== String(comment.id)) return "";
        return `<div class="comment-reaction-picker" role="group" aria-label="React to comment">${REACTIONS.map((reaction) => `<button type="button" data-comment-reaction="${escapeHTML(comment.id)}:${reaction.type}" aria-label="${escapeHTML(reaction.label)}" aria-pressed="${String(comment.current_user_reaction === reaction.type)}"><span aria-hidden="true">${reaction.emoji}</span></button>`).join("")}</div>`;
    }

    function displayName(comment) {
        return [comment.first_name, comment.last_name].filter(Boolean).join(" ").trim() || "Valid user";
    }

    function renderComment(comment, { reply = false } = {}) {
        const busy = reactionBusy.has(String(comment.id));
        const selected = REACTION_BY_TYPE.get(comment.current_user_reaction);
        const ownAction = comment.viewer_can_delete
            ? `<button type="button" data-delete-comment="${escapeHTML(comment.id)}">Delete</button>`
            : `<button type="button" data-report-comment="${escapeHTML(comment.id)}">Report</button>`;
        return `<article class="comment-row ${reply ? "comment-reply" : ""} ${String(highlightedCommentId) === String(comment.id) ? "highlighted" : ""}" data-comment-id="${escapeHTML(comment.id)}">
            ${avatarMarkup(comment, "row-avatar comment-avatar")}
            <div class="comment-content">
                <div class="comment-heading"><strong>${escapeHTML(displayName(comment))}</strong><time>${escapeHTML(relativeTime(comment.created_at))}</time></div>
                <p>${escapeHTML(comment.body || "Comment unavailable")}</p>
                <div class="comment-actions">
                    <button type="button" data-reply-comment="${escapeHTML(comment.id)}">Reply</button>
                    <button class="${selected ? "selected" : ""}" type="button" data-toggle-comment-reactions="${escapeHTML(comment.id)}" ${busy ? "disabled" : ""}>${selected ? `${selected.emoji} ${escapeHTML(selected.label)}` : "React"}</button>
                    ${ownAction}
                    ${renderReactionSummary(comment)}
                </div>
                ${renderReactionPicker(comment)}
            </div>
        </article>`;
    }

    function renderThread(rootComment) {
        const rootId = String(rootComment.id);
        const loadedReplies = replies.get(rootId);
        const replyMarkup = loadedReplies?.map((reply) => renderComment(reply, { reply: true })).join("") || "";
        const remaining = Math.max(0, Number(rootComment.visible_reply_count || 0) - Number(loadedReplies?.length || 0));
        const loadingMoreAllowed = replyHasMore.get(rootId) === true && Number(loadedReplies?.length || 0) < MAX_REPLIES_PER_ROOT;
        const replyButton = !loadedReplies && Number(rootComment.visible_reply_count || 0) > 0
            ? `<button class="comment-load-replies" type="button" data-load-replies="${escapeHTML(rootId)}">View ${Number(rootComment.visible_reply_count)} repl${Number(rootComment.visible_reply_count) === 1 ? "y" : "ies"}</button>`
            : loadingMoreAllowed
            ? `<button class="comment-load-replies" type="button" data-load-replies="${escapeHTML(rootId)}">Load ${remaining || "more"} replies</button>`
            : "";
        return `<section class="comment-thread">${renderComment(rootComment)}${replyMarkup ? `<div class="comment-replies">${replyMarkup}</div>` : ""}${replyButton}</section>`;
    }

    function renderModeration() {
        const container = $("#commentModerationNotice");
        const notice = moderation.notice;
        container.classList.toggle("hidden", !notice);
        container.innerHTML = notice ? `<div><strong>${escapeHTML(notice.title || "Comment update")}</strong><p>${escapeHTML(notice.message || "Your comment access was updated.")}</p></div><button type="button" data-acknowledge-comment-notice>Got it</button>` : "";
    }

    function render() {
        $("#commentsContext").innerHTML = target?.subject ? `<p>${escapeHTML(target.subject)}</p>` : "";
        renderModeration();
        list.innerHTML = roots.length
            ? roots.map(renderThread).join("")
            : `<div class="comments-empty"><strong>No comments yet</strong><p>Start the conversation.</p></div>`;
        $("#loadMoreComments").classList.toggle("hidden", !hasMoreRoots || roots.length >= MAX_ROOTS);
        const replyContext = $("#commentReplyContext");
        replyContext.classList.toggle("hidden", !replyingTo);
        replyContext.innerHTML = replyingTo ? `<span>Replying to <strong>${escapeHTML(displayName(replyingTo))}</strong></span><button type="button" data-cancel-comment-reply aria-label="Cancel reply">×</button>` : "";
        const restriction = restrictionText();
        $("#commentRestriction").textContent = restriction;
        draft.disabled = restrictionActive();
        draft.placeholder = restrictionActive() ? "Commenting is paused" : replyingTo ? `Reply to ${displayName(replyingTo)}…` : "Add a comment…";
        updateComposer();
    }

    function updateComposer() {
        const length = draft.value.length;
        $("#commentCharacterCount").textContent = `${length}/280`;
        sendButton.disabled = creating || restrictionActive() || draft.value.trim().length < 1 || length > 280;
        sendButton.textContent = creating ? "Sending…" : "Send";
        if (pendingCreate && (pendingCreate.body !== draft.value.trim().split(/\s+/).join(" ") || pendingCreate.parentId !== (replyingTo?.id || null))) pendingCreate = null;
    }

    async function loadModeration() {
        try {
            moderation = await api.getCommentModerationState(getUser().id);
            render();
        } catch (_) {
            // A thread remains readable if the optional moderation banner cannot refresh.
        }
    }

    async function loadRoots({ append = false } = {}) {
        $("#commentsStatus").textContent = append ? "Loading older comments…" : "Loading comments…";
        try {
            const cursor = append ? roots.at(-1) : null;
            const page = await call("list", cursor, ROOT_PAGE_SIZE);
            roots = uniqueById(append ? [...roots, ...page] : page).slice(0, MAX_ROOTS);
            hasMoreRoots = page.length === ROOT_PAGE_SIZE && roots.length < MAX_ROOTS;
            $("#commentsStatus").textContent = "";
            render();
        } catch (error) {
            $("#commentsStatus").textContent = error.message || "Could not load comments.";
            if (!append) roots = [];
            render();
        }
    }

    async function loadReplies(rootId, { append = false } = {}) {
        const existing = replies.get(String(rootId)) || [];
        try {
            const page = await call("replies", rootId, append ? existing.at(-1) : null, REPLY_PAGE_SIZE);
            const next = uniqueById(append ? [...existing, ...page] : page).slice(0, MAX_REPLIES_PER_ROOT);
            replies.set(String(rootId), next);
            replyHasMore.set(String(rootId), page.length === REPLY_PAGE_SIZE && next.length < MAX_REPLIES_PER_ROOT);
            render();
        } catch (error) {
            showToast(error.message || "Could not load replies.");
        }
    }

    async function resolveExactComment(commentId) {
        if (!commentId) return;
        try {
            const comment = await call("get", commentId);
            if (comment.root_comment_id) {
                const rootId = String(comment.root_comment_id);
                if (!roots.some((item) => String(item.id) === rootId)) roots.unshift(await call("get", rootId));
                await loadReplies(rootId);
                if (!commentById(comment.id)) replies.set(rootId, uniqueById([...(replies.get(rootId) || []), comment]).slice(0, MAX_REPLIES_PER_ROOT));
            } else if (!roots.some((item) => String(item.id) === String(comment.id))) {
                roots.unshift(comment);
            }
            highlightedCommentId = String(comment.id);
            render();
            requestAnimationFrame(() => list.querySelector(`[data-comment-id="${CSS.escape(String(comment.id))}"]`)?.scrollIntoView({ block: "center" }));
        } catch (_) {
            showToast("That comment is no longer available.");
        }
    }

    async function submit(event) {
        event.preventDefault();
        const body = draft.value.trim().split(/\s+/).join(" ");
        if (!body || creating || restrictionActive()) return;
        const parentId = replyingTo?.id || null;
        if (!pendingCreate || pendingCreate.body !== body || pendingCreate.parentId !== parentId) {
            pendingCreate = { body, parentId, requestId: newRequestId() };
        }
        creating = true;
        updateComposer();
        $("#commentsStatus").textContent = "";
        try {
            const saved = await call("create", body, pendingCreate.requestId, parentId);
            if (saved.moderation_notice) moderation.notice = saved.moderation_notice;
            if (saved.status === "active") {
                if (saved.root_comment_id) {
                    const rootId = String(saved.root_comment_id);
                    replies.set(rootId, uniqueById([...(replies.get(rootId) || []), saved]).slice(0, MAX_REPLIES_PER_ROOT));
                    const rootComment = roots.find((comment) => String(comment.id) === rootId);
                    if (rootComment) rootComment.visible_reply_count = Number(rootComment.visible_reply_count || 0) + 1;
                } else {
                    roots.unshift(saved);
                    roots = uniqueById(roots).slice(0, MAX_ROOTS);
                }
                target.onCountChange?.(1);
                highlightedCommentId = String(saved.id);
            }
            draft.value = "";
            replyingTo = null;
            pendingCreate = null;
            render();
            if (saved.status === "active") showToast("Comment posted");
        } catch (error) {
            $("#commentsStatus").textContent = error.message || "Could not post your comment. Try again.";
        } finally {
            creating = false;
            updateComposer();
        }
    }

    async function setReaction(commentId, reactionType) {
        const comment = commentById(commentId);
        if (!comment || reactionBusy.has(String(commentId))) return;
        reactionBusy.add(String(commentId));
        render();
        try {
            const updated = comment.current_user_reaction === reactionType
                ? await call("removeReaction", commentId)
                : await call("setReaction", commentId, reactionType);
            replaceComment(updated);
            openReactionPickerId = null;
        } catch (error) {
            showToast(error.message || "Could not update reaction.");
        } finally {
            reactionBusy.delete(String(commentId));
            render();
        }
    }

    async function hideComment(commentId, report) {
        const comment = commentById(commentId);
        if (!comment) return;
        const verb = report ? "Report" : "Delete";
        if (!confirm(`${verb} this comment?${report ? " It will disappear immediately and be kept for moderation review." : ""}`)) return;
        try {
            await call(report ? "report" : "delete", commentId, ...(report ? ["inappropriate"] : []));
            const rootId = String(comment.root_comment_id || comment.id);
            let removed = 1;
            if (comment.root_comment_id) {
                replies.set(rootId, (replies.get(rootId) || []).filter((item) => String(item.id) !== String(comment.id)));
                const rootComment = roots.find((item) => String(item.id) === rootId);
                if (rootComment) rootComment.visible_reply_count = Math.max(0, Number(rootComment.visible_reply_count || 0) - 1);
            } else {
                removed += Number(comment.visible_reply_count || 0);
                roots = roots.filter((item) => String(item.id) !== rootId);
                replies.delete(rootId);
            }
            target.onCountChange?.(-removed);
            render();
            showToast(report ? "Comment reported" : "Comment deleted");
        } catch (error) {
            showToast(error.message || `Could not ${report ? "report" : "delete"} comment.`);
        }
    }

    function renderReactors() {
        $("#commentReactorsList").innerHTML = reactorState.rows.length
            ? reactorState.rows.map((reactor) => `<div class="comment-reactor-row">${avatarMarkup(reactor, "row-avatar")}<strong>${escapeHTML([reactor.first_name, reactor.last_name].filter(Boolean).join(" ") || "Valid user")}</strong><span aria-label="${escapeHTML(REACTION_BY_TYPE.get(reactor.reaction_type)?.label || "Reaction")}">${REACTION_BY_TYPE.get(reactor.reaction_type)?.emoji || "✨"}</span></div>`).join("")
            : `<div class="comments-empty"><strong>No reactions yet</strong></div>`;
        $("#loadMoreCommentReactors").classList.toggle("hidden", !reactorState.hasMore || reactorState.rows.length >= MAX_REACTORS);
    }

    async function loadReactors(commentId, { append = false } = {}) {
        if (reactorState.loading) return;
        if (!append) reactorState = { commentId, rows: [], hasMore: false, loading: true };
        else reactorState.loading = true;
        renderReactors();
        try {
            const page = await call("reactors", commentId, reactorState.rows.length, REACTOR_PAGE_SIZE);
            reactorState.rows = uniqueById([...reactorState.rows, ...page]).slice(0, MAX_REACTORS);
            reactorState.hasMore = page.length === REACTOR_PAGE_SIZE && reactorState.rows.length < MAX_REACTORS;
        } catch (error) {
            showToast(error.message || "Could not load reactions.");
        } finally {
            reactorState.loading = false;
            renderReactors();
        }
    }

    async function openReactors(commentId) {
        reactorState = { commentId, rows: [], hasMore: false, loading: false };
        renderReactors();
        reactorsDialog.showModal();
        await loadReactors(commentId);
    }

    async function acknowledgeNotice() {
        const notice = moderation.notice;
        if (!notice) return;
        try {
            await api.acknowledgeCommentModerationNotice(getUser().id, notice.id);
            moderation.notice = null;
            render();
        } catch (error) {
            showToast(error.message || "Could not acknowledge this notice.");
        }
    }

    root.addEventListener("click", (event) => {
        if (event.target.closest("[data-close-comments]")) return closeDetailScreen(dialog);
        if (event.target.closest("[data-acknowledge-comment-notice]")) return void acknowledgeNotice();
        if (event.target.closest("[data-cancel-comment-reply]")) { replyingTo = null; render(); return; }
        const replyButton = event.target.closest("[data-reply-comment]");
        if (replyButton) { replyingTo = commentById(replyButton.dataset.replyComment); render(); draft.focus(); return; }
        const repliesButton = event.target.closest("[data-load-replies]");
        if (repliesButton) return void loadReplies(repliesButton.dataset.loadReplies, { append: replies.has(String(repliesButton.dataset.loadReplies)) });
        const toggleReaction = event.target.closest("[data-toggle-comment-reactions]");
        if (toggleReaction) { openReactionPickerId = String(openReactionPickerId) === String(toggleReaction.dataset.toggleCommentReactions) ? null : toggleReaction.dataset.toggleCommentReactions; render(); return; }
        const reactionButton = event.target.closest("[data-comment-reaction]");
        if (reactionButton) { const [commentId, reaction] = reactionButton.dataset.commentReaction.split(":"); return void setReaction(commentId, reaction); }
        const reactorsButton = event.target.closest("[data-comment-reactors]");
        if (reactorsButton) return void openReactors(reactorsButton.dataset.commentReactors);
        const deleteButton = event.target.closest("[data-delete-comment]");
        if (deleteButton) return void hideComment(deleteButton.dataset.deleteComment, false);
        const reportButton = event.target.closest("[data-report-comment]");
        if (reportButton) return void hideComment(reportButton.dataset.reportComment, true);
        if (event.target.closest("[data-close-comment-reactors]")) return reactorsDialog.close();
    });
    $("#loadMoreComments").addEventListener("click", () => void loadRoots({ append: true }));
    $("#loadMoreCommentReactors").addEventListener("click", () => void loadReactors(reactorState.commentId, { append: true }));
    $("#commentComposer").addEventListener("submit", submit);
    draft.addEventListener("input", updateComposer);
    reactorsDialog.addEventListener("cancel", () => reactorsDialog.close());

    async function open(nextTarget, { commentId = null } = {}) {
        target = nextTarget;
        roots = [];
        replies = new Map();
        replyHasMore = new Map();
        hasMoreRoots = false;
        replyingTo = null;
        highlightedCommentId = commentId ? String(commentId) : null;
        openReactionPickerId = null;
        pendingCreate = null;
        draft.value = "";
        render();
        openDetailScreen(dialog);
        await Promise.all([loadRoots(), loadModeration()]);
        await resolveExactComment(commentId);
    }

    function clear() {
        target = null;
        roots = [];
        replies = new Map();
        replyHasMore = new Map();
        hasMoreRoots = false;
        replyingTo = null;
        highlightedCommentId = null;
        openReactionPickerId = null;
        pendingCreate = null;
        creating = false;
        reactionBusy.clear();
        moderation = { notice: null, restriction: { is_restricted: false, expires_at: null } };
        reactorState = { commentId: null, rows: [], hasMore: false, loading: false };
        draft.value = "";
        list.replaceChildren();
        $("#commentsContext").replaceChildren();
        $("#commentsStatus").textContent = "";
        $("#commentModerationNotice").replaceChildren();
        dialog.classList.add("hidden");
        if (reactorsDialog.open) reactorsDialog.close();
        if (!document.querySelector(".detail-screen:not(.hidden)")) document.body.classList.remove("detail-screen-open");
    }

    return { open, close: () => closeDetailScreen(dialog), clear };
}
