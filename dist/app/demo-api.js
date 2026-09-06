const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function assertLocalDemo() {
    if (!LOCAL_HOSTS.has(window.location.hostname)) {
        throw new Error("The Valid demo is available only on localhost.");
    }
}

function ago(minutes) {
    return new Date(Date.now() - minutes * 60_000).toISOString();
}

function localLedgerDate(date = new Date()) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function displayDemoName(person = {}) {
    return [person.first_name, person.last_name].filter(Boolean).join(" ").trim() || person.username || "Chat";
}

export function localDemoAllowed() {
    return LOCAL_HOSTS.has(window.location.hostname)
        && new URLSearchParams(window.location.search).get("demo") === "1";
}

export class DemoAPI {
    constructor() {
        assertLocalDemo();
        const demoParams = new URLSearchParams(window.location.search);
        const demoAura = demoParams.has("aura") ? Number(demoParams.get("aura")) : Number.NaN;
        this.token = null;
        this.user = null;
        this.deletionRequestedAt = null;
        this.demoGodMode = demoParams.get("godmode") === "1";
        this.profileAskTargetUnavailable = demoParams.get("asktarget") === "unavailable";
        this.demoStoryFailOnce = demoParams.get("storyfail") === "1";
        this.demoCommentFailOnce = demoParams.get("commentfail") === "1";
        this.demoCallsEnabled = demoParams.get("calls") === "1";
        this.demoCalls = new Map();
        this.passkeyCount = demoParams.get("passkeys") === "0" ? 0 : 1;
        this.feedVotesCast = demoParams.get("locked") === "1" ? 1 : 3;
        this.profile = {
            user_id: "demo-user",
            first_name: "Jules",
            last_name: "Rivera",
            username: "jules",
            school_id: 77,
            school_name: "Westview High School",
            grade: "Junior",
            gender: "female",
            bio: "Trying to make senior year unforgettable ✨",
            aura_points: Number.isFinite(demoAura) && demoAura >= 0 ? demoAura : 1280,
            remaining_reveals: this.demoGodMode ? 2 : 0,
            god_mode_aura_multiplier: 2,
            vote_count: 84,
            tbh_unique_requester_count: 7,
            weekly_vote_count: 16,
            current_streak: 7,
            streak_multiplier: 1.5,
            profile_picture_url: "../assets/AppIconV2.png",
            profile_picture_url_thumb: "../assets/AppIconV2.png",
            profile_picture_url_medium: "../assets/AppIconV2.png",
            can_change_information: true,
            next_information_change_at: null,
            active_global_boost: null,
            active_targeted_boosts: [],
        };
        this.topQuestions = {
            weekly: [
                { question_id: 301, question_text: "Who always knows how to make people laugh?", vote_count: 16, image_url: null },
                { question_id: 302, question_text: "Who gives the best advice?", vote_count: 11, image_url: null },
                { question_id: 303, question_text: "Who has the best music taste?", vote_count: 8, image_url: null },
            ],
            all_time: [
                { question_id: 304, question_text: "Who would make the best podcast host?", vote_count: 38, image_url: null },
                { question_id: 305, question_text: "Who is secretly the funniest person here?", vote_count: 29, image_url: null },
                { question_id: 306, question_text: "Who is most likely to start a company?", vote_count: 24, image_url: null },
            ],
        };
        this.personalFeed = [
            {
                item_type: "received_vote",
                timestamp: ago(8),
                question_id: 101,
                question_text: "Who always knows how to make people laugh?",
                image_url: "../assets/app/pencil-clipboard.webp",
                question_answer_id: 9001,
                voted_for_name: "Jules",
                voter_gender: "female",
                voter_grade: "Sophomore",
                voter_first_letter_hint: this.demoGodMode ? "M" : null,
                selected_contact_name: "Jules Rivera",
                presented_options: [
                    { name: "Jules Rivera" }, { name: "Maya Chen" }, { name: "Noah Williams" }, { name: "Ava Patel" },
                ],
                upvote_count: 12,
                user_has_upvoted: false,
                reaction_count: 12,
                reaction_summary: { love: 7, funny: 5 },
                current_user_reaction: null,
                can_react: true,
                comment_count: 1,
            },
            {
                item_type: "received_vote",
                timestamp: ago(95),
                question_id: 102,
                question_text: "Who would make the best podcast host?",
                image_url: "../assets/app/lock.webp",
                question_answer_id: 9002,
                voted_for_name: "Jules",
                voter_gender: "male",
                voter_grade: "Senior",
                voter_first_letter_hint: this.demoGodMode ? "E" : null,
                selected_contact_name: "Jules Rivera",
                presented_options: [
                    { name: "Jules Rivera" }, { name: "Eli Brooks" }, { name: "Sofia Kim" }, { name: "Mateo Lee" },
                ],
                upvote_count: 7,
                user_has_upvoted: true,
                reaction_count: 7,
                reaction_summary: { legacy_agree: 7 },
                current_user_reaction: "legacy_agree",
                can_react: true,
                comment_count: 0,
            },
        ];
        this.schoolFeed = [
            {
                item_type: "school_activity",
                timestamp: ago(3),
                question_id: 103,
                question_text: "Who has the best music taste?",
                image_url: "../assets/app/anonymous.webp",
                question_answer_id: 9003,
                voted_for_name: "Maya Chen",
                voted_for_profile_picture_url: "../assets/app/anonymous.webp",
                voter_gender: "female",
                voter_grade: "Junior",
                selected_contact_name: "Maya Chen",
                presented_options: [
                    { name: "Maya Chen" }, { name: "Jules Rivera" }, { name: "Noah Williams" }, { name: "Ava Patel" },
                ],
                upvote_count: 19,
                user_has_upvoted: false,
                reaction_count: 19,
                reaction_summary: { fire: 12, love: 7 },
                current_user_reaction: null,
                can_react: true,
                comment_count: 4,
            },
            {
                item_type: "school_activity",
                timestamp: ago(42),
                question_id: 104,
                question_text: "Who is most likely to start a company?",
                question_answer_id: 9004,
                voted_for_name: "Noah Williams",
                voted_for_profile_picture_url: "../assets/app/lock.webp",
                voter_gender: "male",
                voter_grade: "Sophomore",
                current_user_voted: true,
                selected_contact_name: "Noah Williams",
                presented_options: [
                    { name: "Noah Williams" }, { name: "Jules Rivera" }, { name: "Sofia Kim" }, { name: "Mateo Lee" },
                ],
                upvote_count: 5,
                user_has_upvoted: false,
                reaction_count: 5,
                reaction_summary: { funny: 5 },
                current_user_reaction: null,
                can_react: false,
                comment_count: 0,
            },
        ];
        this.questions = [
            { id: 201, question_text: "Who would survive longest on a deserted island?", image_url: "../assets/app/lock.webp" },
            { id: 202, question_text: "Who should plan the senior trip?", image_url: "../assets/app/pencil-clipboard.webp", is_user_submitted: true, is_anonymous: false, submitted_by_name: "Maya Chen", submitted_by_avatar_url: "../assets/app/anonymous.webp" },
            { id: 203, question_text: "Who gives the best advice?", image_url: "../assets/app/anonymous.webp" },
            { id: 204, question_text: "Who is secretly the funniest person here?", image_url: "../assets/AppIconV2.png" },
        ];
        this.questionSubmissions = [
            { id: "submission-demo-approved", status: "approved", question_text: "Who always makes new students feel welcome?", image_url: "../assets/app/pencil-clipboard.webp", aura_spent: 200, is_anonymous: false, submitted_at: ago(10_080), reviewed_at: ago(8_640), question_id: 701, question_is_active: true, vote_count: 8, results_visible: true, results_minimum_votes: 5, vote_results: [{ name: "Maya Chen", vote_count: 4 }, { name: "Noah Williams", vote_count: 3 }, { name: "Ava Patel", vote_count: 1 }] },
            { id: "submission-demo-pending", status: "pending", question_text: "Who has the most creative study routine?", image_url: "../assets/app/anonymous.webp", aura_spent: 200, is_anonymous: true, submitted_at: ago(180), reviewed_at: null, question_id: null, question_is_active: null, vote_count: 0, results_visible: false, results_minimum_votes: 5, vote_results: [] },
        ];
        this.classmates = [
            { user_id: "classmate-1", first_name: "Maya", last_name: "Chen", username: "maya_c", grade: "Senior", school_name: "Westview High School", bio: "Student council and bad puns.", vote_count: 61, weekly_vote_count: 22, ask_link_active: true, profile_picture_url: "../assets/app/anonymous.webp" },
            { user_id: "classmate-2", first_name: "Noah", last_name: "Williams", username: "noahw", grade: "Sophomore", school_name: "Westview High School", vote_count: 44, weekly_vote_count: 19, profile_picture_url: "../assets/app/lock.webp" },
            { user_id: "classmate-3", first_name: "Ava", last_name: "Patel", username: "avap", grade: "Junior", school_name: "Westview High School", vote_count: 39, weekly_vote_count: 14, profile_picture_url: "../assets/app/pencil-clipboard.webp" },
            { user_id: "classmate-4", first_name: "Eli", last_name: "Brooks", username: "elib", grade: "Junior", school_name: "Westview High School", vote_count: 31, weekly_vote_count: 11, profile_picture_url: "../assets/AppIconV2.png" },
            { user_id: "classmate-5", first_name: "Sofia", last_name: "Kim", username: "sofiak", grade: "Freshman", school_name: "Westview High School", vote_count: 27, weekly_vote_count: 9, profile_picture_url: "../assets/app/aura.webp" },
            { user_id: "classmate-6", first_name: "Mateo", last_name: "Lee", username: "mateol", grade: "Senior", school_name: "Westview High School", vote_count: 24, weekly_vote_count: 7, profile_picture_url: "../assets/valid_logo.png" },
        ];
        this.inviteStatus = { limit: 3, sent_today: 1, remaining: 2, next_reset_at: ago(-720), qualifying_invites: 0, aura_reward_progress: 0, aura_reward_goal: 3, aura_reward_amount: 50, aura_rewards_claimed: 0, aura_rewards_max: 1, aura_reward_max_reached: false };
        this.askLink = {
            share_url: "https://validapp.lol/a/jules-demo",
            is_active: true,
        };
        this.askAccess = {
            status: "allowed",
            timeout_until: null,
            warning_count: 0,
            timeout_count: 0,
            message: null,
        };
        this.askSafetyNotices = [];
        const askRestriction = demoParams.get("askrestriction");
        if (askRestriction === "timeout") {
            const timeoutUntil = new Date(Date.now() + 14 * 86_400_000).toISOString();
            this.askLink.is_active = false;
            this.askAccess = {
                status: "timed_out",
                timeout_until: timeoutUntil,
                warning_count: 1,
                timeout_count: 1,
                message: "Your Ask Me access is paused for 14 days because messages you sent violated our safety rules.",
            };
        } else if (askRestriction === "ban") {
            this.askLink.is_active = false;
            this.askAccess = {
                status: "banned",
                timeout_until: null,
                warning_count: 1,
                timeout_count: 1,
                message: "Your access to Ask Me has been permanently removed because of repeated or serious safety violations.",
            };
        }
        if (demoParams.get("safetynotice") === "1") {
            this.askSafetyNotices.push({
                id: "demo-safety-notice",
                action: "warning",
                title: "Ask Me safety warning",
                message: "One of your Ask Me messages was reviewed and found to violate our safety rules.",
                timeout_until: null,
                acknowledged_at: null,
                created_at: new Date().toISOString(),
            });
        }
        this.anonymousInbox = {
            questions: [
                {
                    id: "ask-demo-1",
                    body: "What is something you are genuinely proud of this year?",
                    sender_type: "guest",
                    provenance_label: "From someone anonymous",
                    provenance_detail: "Sent anonymously from the web.",
                    source_platform: "instagram",
                    status: "received",
                    created_at: ago(18),
                    opened_at: null,
                    answered_at: null,
                    answer_text: null,
                    aura_points_earned: 0,
                },
                {
                    id: "ask-demo-2",
                    body: "Who has been making school better lately?",
                    sender_type: "valid_member",
                    provenance_label: "From a Valid member",
                    provenance_detail: "Their identity always stays private.",
                    source_platform: null,
                    status: "received",
                    created_at: ago(144),
                    opened_at: ago(120),
                    answered_at: null,
                    answer_text: null,
                    aura_points_earned: 0,
                },
            ],
            answers: [
                {
                    id: "answer-demo-1",
                    question_body: "What always makes you laugh in class?",
                    answer_text: "Your impressions of our history teacher 😂",
                    recipient_display_name: "Maya Chen",
                    recipient_username: "maya_c",
                    recipient_profile_picture_url: "../assets/app/anonymous.webp",
                    answered_at: ago(42),
                },
            ],
        };
        this.tbhTargets = this.classmates.map((classmate, index) => ({
            ...classmate,
            state: index === 1 ? "active" : index === 2 ? "cooldown" : "eligible",
            active_request_id: index === 1 ? "active-demo-request" : null,
            next_allowed_at: index === 2 ? new Date(Date.now() + 6 * 3_600_000).toISOString() : null,
        }));
        this.tbhPending = [{
            id: "tbh-request-1", requester_user_id: "classmate-1", recipient_user_id: "demo-user",
            requester_first_name: "Maya", requester_last_name: "Chen", requester_username: "maya_c",
            requester_profile_picture_url: "../assets/app/anonymous.webp", prompt_key: "your_vibe", status: "pending",
            aura_spent: 100, created_at: ago(6), expires_at: ago(-10_000), snoozed_until: null, snooze_count: 0, opened_at: null,
        }];
        this.tbhInbox = [{
            id: "tbh-response-1", request_id: "answered-request-1", body: "You make every group project more fun, and you always notice when someone needs help.", prompt_key: "best_quality",
            author_user_id: "classmate-2", author_first_name: "Noah", author_last_name: "Williams", author_username: "noahw", author_profile_picture_url: "../assets/app/lock.webp",
            created_at: ago(25), opened_at: null, activity_id: "activity-tbh-1", reaction_count: 4, reaction_summary: { love: 3, fire: 1 }, current_user_reaction: null, can_react: true, comment_count: 3,
        }];
        this.tbhSent = [{
            id: "tbh-response-2", request_id: "answered-request-2", body: "Your energy is calm until the music starts, then you become the whole party.", prompt_key: "your_vibe",
            subject_user_id: "classmate-4", subject_first_name: "Eli", subject_last_name: "Brooks", subject_profile_picture_url: "../assets/AppIconV2.png",
            created_at: ago(70), activity_id: "activity-tbh-2", reaction_count: 2, reaction_summary: { funny: 2 }, current_user_reaction: "funny", can_react: true, comment_count: 0,
        }];
        this.tbhSchool = [
            { ...this.tbhInbox[0], subject_user_id: "demo-user", subject_first_name: "Jules", subject_last_name: "Rivera", subject_profile_picture_url: "../assets/AppIconV2.png", author_gender: "male", author_grade: "Sophomore" },
            { ...this.tbhSent[0], author_gender: "female", author_grade: "Junior" },
        ];
        this.reactors = {
            "9001": [{ user_id: "classmate-1", first_name: "Maya", last_name: "Chen", profile_picture_url: "../assets/app/anonymous.webp", reaction_type: "love", reacted_at: ago(4) }],
            "activity-tbh-1": [{ user_id: "classmate-4", first_name: "Eli", last_name: "Brooks", profile_picture_url: "../assets/AppIconV2.png", reaction_type: "fire", reacted_at: ago(8) }],
        };
        this.commentModerationState = {
            notice: demoParams.get("commentnotice") === "1" ? {
                id: 71,
                type: "warning",
                title: "Comment removed",
                message: "One of your comments was reported and hidden.",
                mark_number: 1,
                threshold: 3,
                action: "warning",
                created_at: new Date().toISOString(),
            } : null,
            restriction: demoParams.get("commentrestricted") === "1"
                ? { is_restricted: true, expires_at: new Date(Date.now() + 86_400_000).toISOString() }
                : { is_restricted: false, expires_at: null },
        };
        this.commentThreads = {
            "poll:9003": [
                { id: "11111111-1111-4111-8111-111111111111", question_answer_id: 9003, author_user_id: "classmate-1", root_comment_id: null, parent_comment_id: null, body: "This one is so accurate.", status: "active", visible_reply_count: 2, reaction_count: 2, reaction_summary: { love: 1, fire: 1 }, current_user_reaction: null, mutation_version: 1, first_name: "Maya", last_name: "Chen", profile_picture_url: "../assets/app/anonymous.webp", viewer_can_delete: false, moderation_notice: null, created_at: ago(16), updated_at: ago(16) },
                { id: "11111111-1111-4111-8111-111111111112", question_answer_id: 9003, author_user_id: "demo-user", root_comment_id: "11111111-1111-4111-8111-111111111111", parent_comment_id: "11111111-1111-4111-8111-111111111111", body: "Right? Maya knows everyone.", status: "active", visible_reply_count: 0, reaction_count: 0, reaction_summary: {}, current_user_reaction: null, mutation_version: 0, first_name: "Jules", last_name: "Rivera", profile_picture_url: "../assets/AppIconV2.png", viewer_can_delete: true, moderation_notice: null, created_at: ago(14), updated_at: ago(14) },
                { id: "11111111-1111-4111-8111-111111111113", question_answer_id: 9003, author_user_id: "classmate-2", root_comment_id: "11111111-1111-4111-8111-111111111111", parent_comment_id: "11111111-1111-4111-8111-111111111112", body: "The playlist proves it 🔥", status: "active", visible_reply_count: 0, reaction_count: 1, reaction_summary: { fire: 1 }, current_user_reaction: "fire", mutation_version: 1, first_name: "Noah", last_name: "Williams", profile_picture_url: "../assets/app/lock.webp", viewer_can_delete: false, moderation_notice: null, created_at: ago(12), updated_at: ago(12) },
                { id: "11111111-1111-4111-8111-111111111114", question_answer_id: 9003, author_user_id: "demo-user", root_comment_id: null, parent_comment_id: null, body: "The whole school voted correctly.", status: "active", visible_reply_count: 0, reaction_count: 0, reaction_summary: {}, current_user_reaction: null, mutation_version: 0, first_name: "Jules", last_name: "Rivera", profile_picture_url: "../assets/AppIconV2.png", viewer_can_delete: true, moderation_notice: null, created_at: ago(8), updated_at: ago(8) },
            ],
            "activity:activity-tbh-1": [
                { id: "22222222-2222-4222-8222-222222222221", activity_id: "activity-tbh-1", author_user_id: "classmate-4", root_comment_id: null, parent_comment_id: null, body: "This is genuinely sweet.", status: "active", visible_reply_count: 1, reaction_count: 1, reaction_summary: { love: 1 }, current_user_reaction: null, mutation_version: 1, first_name: "Eli", last_name: "Brooks", profile_picture_url: "../assets/AppIconV2.png", viewer_can_delete: false, moderation_notice: null, created_at: ago(20), updated_at: ago(20) },
                { id: "22222222-2222-4222-8222-222222222222", activity_id: "activity-tbh-1", author_user_id: "demo-user", root_comment_id: "22222222-2222-4222-8222-222222222221", parent_comment_id: "22222222-2222-4222-8222-222222222221", body: "Noah always notices the good stuff.", status: "active", visible_reply_count: 0, reaction_count: 0, reaction_summary: {}, current_user_reaction: null, mutation_version: 0, first_name: "Jules", last_name: "Rivera", profile_picture_url: "../assets/AppIconV2.png", viewer_can_delete: true, moderation_notice: null, created_at: ago(18), updated_at: ago(18) },
                { id: "22222222-2222-4222-8222-222222222223", activity_id: "activity-tbh-1", author_user_id: "classmate-1", root_comment_id: null, parent_comment_id: null, body: "Best kind of TBH.", status: "active", visible_reply_count: 0, reaction_count: 0, reaction_summary: {}, current_user_reaction: null, mutation_version: 0, first_name: "Maya", last_name: "Chen", profile_picture_url: "../assets/app/anonymous.webp", viewer_can_delete: false, moderation_notice: null, created_at: ago(10), updated_at: ago(10) },
            ],
        };
        const now = new Date().toISOString();
        const ledgerDate = localLedgerDate();
        this.chats = [
            {
                id: "chat-friends", display_name: "Weekend Crew", name: "Weekend Crew", status: "active",
                owner_user_id: "demo-user", membership_id: "membership-friends", membership_status: "accepted", role: "owner",
                accepted_count: 4, pending_count: 0, moment_streak: 6, today_memento_count: 2,
                today_memento_eligible_count: 4, has_posted_today_memento: false, is_memento_eligible_today: true,
                member_cap: 50, unread_count: 2, regular_unread_count: 2, last_room_sequence: 4, last_read_sequence: 2,
                notification_level: "all", chat_photo_url: "../assets/AppIconV2.png",
                member_previews: this.classmates.slice(0, 3), last_message_body: "Meet at the game?", last_message_kind: "text",
                last_message_sender_first_name: "Maya", last_message_is_mine: false, last_message_at: ago(4), created_at: ago(10_000), updated_at: ago(4),
            },
            {
                id: "chat-noah", display_name: "Noah Williams", name: null, status: "active",
                owner_user_id: "classmate-2", membership_id: "membership-noah", membership_status: "accepted", role: "member",
                accepted_count: 2, pending_count: 0, moment_streak: 2, today_memento_count: 2,
                today_memento_eligible_count: 2, has_posted_today_memento: true, is_memento_eligible_today: true,
                member_cap: 50, unread_count: 0, regular_unread_count: 0, last_room_sequence: 3, last_read_sequence: 3,
                notification_level: "all", pair_profile_picture_url: "../assets/app/lock.webp",
                member_previews: [this.classmates[1]], last_message_body: "That was hilarious 😂", last_message_kind: "text",
                last_message_sender_first_name: "Jules", last_message_is_mine: true, last_message_at: ago(70), created_at: ago(20_000), updated_at: ago(70),
            },
            {
                id: "chat-invite", display_name: "Art Club", name: "Art Club", status: "pending",
                owner_user_id: "classmate-1", membership_id: "membership-invite", membership_status: "invited", role: "member",
                accepted_count: 5, pending_count: 1, moment_streak: 0, today_memento_count: 0, today_memento_eligible_count: 5,
                has_posted_today_memento: false, is_memento_eligible_today: true, member_cap: 50, unread_count: 0,
                last_room_sequence: 0, last_read_sequence: 0, notification_level: "all", member_previews: this.classmates.slice(0, 3),
                invited_by_first_name: "Maya", invited_by_last_name: "Chen", created_at: ago(300), updated_at: ago(300),
            },
        ];
        this.chatMembers = {
            "chat-friends": [
                { membership_id: "m-demo", user_id: "demo-user", role: "owner", status: "accepted", first_name: "Jules", last_name: "Rivera", profile_picture_url: this.profile.profile_picture_url },
                ...this.classmates.slice(0, 3).map((person, index) => ({ membership_id: `m-friend-${index}`, user_id: person.user_id, role: "member", status: "accepted", ...person })),
            ],
            "chat-noah": [
                { membership_id: "m-demo-noah", user_id: "demo-user", role: "member", status: "accepted", first_name: "Jules", last_name: "Rivera", profile_picture_url: this.profile.profile_picture_url },
                { membership_id: "m-noah", role: "owner", status: "accepted", ...this.classmates[1], last_read_sequence: 3 },
            ],
        };
        this.chatMessages = {
            "chat-friends": [
                { id: "msg-1", chat_id: "chat-friends", room_sequence: 1, sender_user_id: "classmate-1", sender_first_name: "Maya", kind: "text", body: "What are we doing Friday?", status: "active", viewer_is_sender: false, reaction_count: 1, reaction_summary: { love: 1 }, current_user_reaction: null, created_at: ago(55), updated_at: ago(55) },
                { id: "msg-2", chat_id: "chat-friends", room_sequence: 2, sender_user_id: "demo-user", sender_first_name: "Jules", kind: "text", body: "Game, then food?", status: "active", viewer_is_sender: true, reaction_count: 2, reaction_summary: { fire: 2 }, current_user_reaction: "fire", created_at: ago(35), updated_at: ago(35) },
                { id: "msg-3", chat_id: "chat-friends", room_sequence: 3, sender_user_id: "classmate-3", sender_first_name: "Ava", kind: "memento", body: "Bus ride energy", memento_image_url: "../assets/app/anonymous.webp", memento_ledger_date: ledgerDate, status: "active", viewer_is_sender: false, reaction_count: 0, reaction_summary: {}, created_at: ago(12), updated_at: ago(12) },
                { id: "msg-4", chat_id: "chat-friends", room_sequence: 4, sender_user_id: "classmate-1", sender_first_name: "Maya", kind: "text", body: "Meet at the game?", status: "active", viewer_is_sender: false, reaction_count: 0, reaction_summary: {}, created_at: ago(4), updated_at: ago(4) },
            ],
            "chat-noah": [
                { id: "msg-n1", chat_id: "chat-noah", room_sequence: 1, sender_user_id: "classmate-2", sender_first_name: "Noah", kind: "text", body: "Did you see that presentation?", status: "active", viewer_is_sender: false, reaction_count: 0, reaction_summary: {}, created_at: ago(100), updated_at: ago(100) },
                { id: "msg-n2", chat_id: "chat-noah", room_sequence: 2, sender_user_id: "demo-user", sender_first_name: "Jules", kind: "memento", body: "Sent a Memento", daily_entry_id: "entry-jules", memento_image_url: "../assets/app/pencil-clipboard.webp", memento_swapped_image_url: "../assets/app/anonymous.webp", memento_ledger_date: ledgerDate, status: "active", viewer_is_sender: true, reaction_count: 1, reaction_summary: { funny: 1 }, created_at: ago(80), updated_at: ago(80) },
                { id: "msg-n3", chat_id: "chat-noah", room_sequence: 3, sender_user_id: "demo-user", sender_first_name: "Jules", kind: "text", body: "That was hilarious 😂", status: "active", viewer_is_sender: true, reaction_count: 0, reaction_summary: {}, created_at: ago(70), updated_at: ago(70) },
                { id: "msg-n4", chat_id: "chat-noah", room_sequence: 4, sender_user_id: "classmate-2", sender_first_name: "Noah", kind: "photo", body: null, photo_image_url: null, view_once: true, view_once_available: true, view_once_consumed: false, view_once_remaining_views: 2, view_once_opened_count: 0, view_once_recipient_count: 1, media_text_overlay: { text: "Game night", x: 0.5, y: 0.5 }, status: "active", viewer_is_sender: false, reaction_count: 0, reaction_summary: {}, created_at: ago(60), updated_at: ago(60) },
                { id: "msg-n5", chat_id: "chat-noah", room_sequence: 5, sender_user_id: "demo-user", sender_first_name: "Jules", kind: "photo", body: null, photo_image_url: null, view_once: true, view_once_available: false, view_once_consumed: false, view_once_remaining_views: 0, view_once_opened_count: 1, view_once_recipient_count: 1, status: "active", viewer_is_sender: true, reaction_count: 0, reaction_summary: {}, created_at: ago(50), updated_at: ago(50) },
            ],
        };
        this.chatMediaAssets = {};
        this.dailyMediaAssets = {};
        this.chatViewSessions = {};
        this.dailyRows = {
            "chat-friends": { chat_id: "chat-friends", ledger_date: ledgerDate, viewer_has_posted_today: false, viewer_has_shared: false, viewer_is_eligible: true, view_gate_locked: true, posted_count: 2, eligible_count: 4, entries: [
                { user_id: "classmate-1", first_name: "Maya", last_name: "Chen", has_posted: true, entry_id: "entry-maya", caption: "After practice", image_url: "../assets/app/anonymous.webp", swapped_image_url: "../assets/app/lock.webp", published_at: ago(14) },
                { user_id: "classmate-3", first_name: "Ava", last_name: "Patel", has_posted: true, entry_id: "entry-ava", caption: "Bus ride", image_url: "../assets/app/pencil-clipboard.webp", swapped_image_url: "../assets/app/anonymous.webp", published_at: ago(12) },
                { user_id: "demo-user", first_name: "Jules", last_name: "Rivera", has_posted: false },
            ] },
            "chat-noah": { chat_id: "chat-noah", ledger_date: ledgerDate, viewer_has_posted_today: true, viewer_has_shared: true, viewer_is_eligible: true, view_gate_locked: false, posted_count: 2, eligible_count: 2, entries: [
                { user_id: "demo-user", first_name: "Jules", last_name: "Rivera", has_posted: true, entry_id: "entry-jules", caption: "Today", image_url: "../assets/app/pencil-clipboard.webp", swapped_image_url: "../assets/app/anonymous.webp", published_at: ago(80) },
                { user_id: "classmate-2", first_name: "Noah", last_name: "Williams", has_posted: true, entry_id: "entry-noah", caption: "Lunch", image_url: "../assets/app/lock.webp", swapped_image_url: "../assets/AppIconV2.png", published_at: ago(75) },
            ] },
        };
    }

    hasSession() {
        return Boolean(this.token && this.user?.id);
    }

    async demoLogin() {
        assertLocalDemo();
        return {
            access_token: "local-demo-memory-only",
            user: { id: "demo-user", subscribed_user: this.demoGodMode, remaining_reveals: this.profile.remaining_reveals, deletion_requested_at: this.deletionRequestedAt },
        };
    }

    async resolveSchool(payload) {
        const school = { id: 1000 + (this.resolvedSchools?.length || 0), name: payload.school_name, city: payload.city, state: payload.state, min_grade: 6, max_grade: 12 };
        this.resolvedSchools = [...(this.resolvedSchools || []), school];
        return { school };
    }

    async getNearbySchools(zipCode, limit = 50) {
        const names = [
            "Westview High School", "Central High School", "Lincoln High School", "Roosevelt High School",
            "Washington High School", "Jefferson High School", "Northside High School", "Southridge High School",
        ];
        const schools = Array.from({ length: Math.min(50, limit) }, (_, index) => ({
            id: 77 + index,
            name: index === 0 ? names[0] : `${names[1 + ((index - 1) % (names.length - 1))]} ${index + 1}`,
            city: index % 2 ? "Beverly Hills" : "Los Angeles",
            state: "CA",
            logo_url: "",
            member_count: Math.max(0, 25 - index),
            min_grade: 9,
            max_grade: 12,
            distance_miles: Number((0.4 + index * 0.3).toFixed(1)),
        }));
        this.nearbySchools = schools;
        return {
            zip_code: zipCode,
            schools,
        };
    }

    async checkUsernameAvailability(username) {
        const normalized = String(username || "").trim().toLowerCase();
        const skeleton = normalized.replace(/[^a-z0-9]/g, "").replace(/[01345789]/g, (value) => ({ 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", 9: "g" })[value]);
        const inappropriate = /p+o+r+n+(?:o+)?|f+a+g+(?:o+t+)?(?![aeiu])|n+i+g{2,}(?:e+r+|a+)/.test(skeleton);
        return { available: /^[a-z0-9_]{3,30}$/.test(normalized) && !inappropriate && normalized !== "taken" };
    }

    async checkPhoneRegistration() {
        return { exists: false, vote_count: 3, status: "available", has_profile: false };
    }

    async demoSignup(payload) {
        Object.assign(this.profile, payload.profile, {
            user_id: "demo-user",
            school_name: payload.school_name,
        });
        return { access_token: "local-demo-memory-only", user: { id: "demo-user" }, profile: this.profile };
    }

    saveSession(loginResponse) {
        this.token = loginResponse.access_token;
        this.user = loginResponse.user;
    }

    clearSession() {
        this.token = null;
        this.user = null;
    }

    async logout() {
        this.clearSession();
    }

    assetURL(path) {
        if (!path) return null;
        try {
            return new URL(path).href;
        } catch (_) {
            return new URL(path, window.location.origin).href;
        }
    }

    async getProfile(userId = "demo-user") {
        if (userId !== "demo-user") {
            const classmate = this.classmates.find((candidate) => candidate.user_id === userId);
            if (classmate) return { ...classmate };
        }
        return { ...this.profile };
    }

    async getUser() {
        return { ...this.user };
    }

    async getPasskeyStatus() {
        return { registered: this.passkeyCount > 0, credentialCount: this.passkeyCount };
    }

    async addDemoPasskey() {
        this.passkeyCount += 1;
        return { status: "ok" };
    }

    async getTopQuestions(_userId, period = "weekly", limit = 10) {
        return (this.topQuestions[period] || []).slice(0, limit).map((question) => ({ ...question }));
    }

    async getPersonalFeed(_userId, offset = 0) {
        return offset ? [] : this.personalFeed.map((item) => ({ ...item }));
    }

    async getSchoolFeed(_userId, cursor = null, _search = "", sort = "recent") {
        if (cursor) return [];
        const items = this.schoolFeed.map((item) => ({ ...item }));
        if (sort === "hottest") items.sort((left, right) => Number(right.reaction_count || 0) - Number(left.reaction_count || 0));
        return items;
    }

    async getUserVotes(_userId, cursor = null) {
        return cursor ? [] : this.schoolFeed.filter((item) => item.current_user_voted).map((item) => ({ ...item }));
    }

    async toggleUpvote(_userId, answerId) {
        const item = [...this.personalFeed, ...this.schoolFeed]
            .find((candidate) => candidate.question_answer_id === answerId);
        if (!item) throw new Error("Vote not found");
        item.user_has_upvoted = !item.user_has_upvoted;
        return { was_added: item.user_has_upvoted };
    }

    reactionItem(targetId, activity = false) {
        const items = activity ? [...this.tbhInbox, ...this.tbhSent, ...this.tbhSchool] : [...this.personalFeed, ...this.schoolFeed];
        return items.find((item) => String(activity ? item.activity_id : item.question_answer_id) === String(targetId));
    }

    mutateReaction(targetId, reactionType, activity = false) {
        const matching = (activity ? [...this.tbhInbox, ...this.tbhSent, ...this.tbhSchool] : [...this.personalFeed, ...this.schoolFeed])
            .filter((item) => String(activity ? item.activity_id : item.question_answer_id) === String(targetId));
        if (!matching.length) throw new Error("Post not found");
        const item = matching[0];
        const previous = item.current_user_reaction || null;
        const summary = { ...(item.reaction_summary || {}) };
        let count = Number(item.reaction_count || 0);
        if (previous) {
            summary[previous] = Math.max(0, Number(summary[previous] || 0) - 1);
            if (!summary[previous]) delete summary[previous];
        }
        if (reactionType) {
            summary[reactionType] = Number(summary[reactionType] || 0) + 1;
            if (!previous) count += 1;
        } else if (previous) count -= 1;
        matching.forEach((candidate) => Object.assign(candidate, { reaction_count: Math.max(0, count), reaction_summary: { ...summary }, current_user_reaction: reactionType }));
        return { [activity ? "activity_id" : "question_answer_id"]: targetId, reaction_type: reactionType, previous_reaction_type: previous, reaction_count: Math.max(0, count), reaction_summary: summary, changed: previous !== reactionType };
    }

    async setFeedReaction(_userId, answerId, reactionType) { return this.mutateReaction(answerId, reactionType, false); }
    async removeFeedReaction(_userId, answerId) { return this.mutateReaction(answerId, null, false); }
    async getFeedReactors(_userId, answerId) { return structuredClone(this.reactors[String(answerId)] || []); }
    async getFeedItem(_userId, answerId) {
        const item = [...this.personalFeed, ...this.schoolFeed].find((candidate) => String(candidate.question_answer_id) === String(answerId));
        if (!item) throw new Error("Vote not found");
        return structuredClone(item);
    }
    async setFeedActivityReaction(_userId, activityId, reactionType) { return this.mutateReaction(activityId, reactionType, true); }
    async removeFeedActivityReaction(_userId, activityId) { return this.mutateReaction(activityId, null, true); }
    async getFeedActivityReactors(_userId, activityId) { return structuredClone(this.reactors[String(activityId)] || []); }

    commentThread(type, targetId) {
        const key = `${type}:${targetId}`;
        if (!this.commentThreads[key]) this.commentThreads[key] = [];
        return this.commentThreads[key];
    }

    commentTargetItem(type, targetId) {
        return type === "poll"
            ? [...this.personalFeed, ...this.schoolFeed].find((item) => String(item.question_answer_id) === String(targetId))
            : [...this.tbhInbox, ...this.tbhSent, ...this.tbhSchool].find((item) => String(item.activity_id) === String(targetId));
    }

    async getCommentModerationState() { return structuredClone(this.commentModerationState); }
    async acknowledgeCommentModerationNotice(_userId, noticeId) {
        if (Number(this.commentModerationState.notice?.id) === Number(noticeId)) this.commentModerationState.notice = null;
        return { acknowledged: true };
    }

    listDemoComments(type, targetId, before = null, limit = 30) {
        const roots = this.commentThread(type, targetId)
            .filter((comment) => !comment.root_comment_id && comment.status === "active")
            .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
        const start = before ? Math.max(0, roots.findIndex((comment) => String(comment.id) === String(before.id)) + 1) : 0;
        return structuredClone(roots.slice(start, start + limit));
    }

    getDemoComment(type, targetId, commentId) {
        const comment = this.commentThread(type, targetId).find((candidate) => String(candidate.id) === String(commentId) && candidate.status === "active");
        if (!comment) throw new Error("Comment not found");
        return structuredClone(comment);
    }

    listDemoReplies(type, targetId, rootId, after = null, limit = 50) {
        const replies = this.commentThread(type, targetId)
            .filter((comment) => String(comment.root_comment_id) === String(rootId) && comment.status === "active")
            .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
        const start = after ? Math.max(0, replies.findIndex((comment) => String(comment.id) === String(after.id)) + 1) : 0;
        return structuredClone(replies.slice(start, start + limit));
    }

    createDemoComment(type, targetId, body, clientRequestId, parentCommentId = null) {
        const thread = this.commentThread(type, targetId);
        const existing = thread.find((comment) => String(comment.id) === String(clientRequestId));
        if (existing) return structuredClone(existing);
        if (this.commentModerationState.restriction?.is_restricted) throw new Error("Commenting has been disabled for this account");
        const parent = parentCommentId ? thread.find((comment) => String(comment.id) === String(parentCommentId)) : null;
        const rootId = parent ? (parent.root_comment_id || parent.id) : null;
        const comment = {
            id: clientRequestId,
            ...(type === "poll" ? { question_answer_id: Number(targetId) } : { activity_id: targetId }),
            author_user_id: "demo-user",
            root_comment_id: rootId,
            parent_comment_id: parentCommentId,
            body: String(body).trim().split(/\s+/).join(" "),
            status: "active",
            visible_reply_count: 0,
            reaction_count: 0,
            reaction_summary: {},
            current_user_reaction: null,
            mutation_version: 0,
            first_name: "Jules",
            last_name: "Rivera",
            profile_picture_url: "../assets/AppIconV2.png",
            viewer_can_delete: true,
            moderation_notice: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        thread.push(comment);
        if (rootId) {
            const root = thread.find((candidate) => String(candidate.id) === String(rootId));
            if (root) root.visible_reply_count = Number(root.visible_reply_count || 0) + 1;
        }
        const item = this.commentTargetItem(type, targetId);
        if (item) item.comment_count = Number(item.comment_count || 0) + 1;
        if (this.demoCommentFailOnce) {
            this.demoCommentFailOnce = false;
            throw new Error("The response was lost after the server saved this comment.");
        }
        return structuredClone(comment);
    }

    mutateDemoCommentReaction(type, targetId, commentId, reactionType) {
        const comment = this.commentThread(type, targetId).find((candidate) => String(candidate.id) === String(commentId));
        if (!comment) throw new Error("Comment not found");
        const previous = comment.current_user_reaction;
        if (previous) {
            comment.reaction_summary[previous] = Math.max(0, Number(comment.reaction_summary[previous] || 0) - 1);
            if (!comment.reaction_summary[previous]) delete comment.reaction_summary[previous];
            comment.reaction_count = Math.max(0, Number(comment.reaction_count || 0) - 1);
        }
        if (reactionType) {
            comment.reaction_summary[reactionType] = Number(comment.reaction_summary[reactionType] || 0) + 1;
            comment.reaction_count = Number(comment.reaction_count || 0) + 1;
        }
        comment.current_user_reaction = reactionType;
        comment.mutation_version = Number(comment.mutation_version || 0) + 1;
        return structuredClone(comment);
    }

    getDemoCommentReactors(type, targetId, commentId, offset = 0, limit = 50) {
        const comment = this.getDemoComment(type, targetId, commentId);
        const rows = Object.entries(comment.reaction_summary || {}).flatMap(([reaction, count]) => Array.from({ length: count }, (_, index) => ({
            user_id: `${commentId}-${reaction}-${index}`,
            first_name: index ? "Noah" : "Maya",
            last_name: index ? "Williams" : "Chen",
            profile_picture_url: index ? "../assets/app/lock.webp" : "../assets/app/anonymous.webp",
            reaction_type: reaction,
            reacted_at: ago(index + 1),
        })));
        return structuredClone(rows.slice(offset, offset + limit));
    }

    hideDemoComment(type, targetId, commentId, status) {
        const thread = this.commentThread(type, targetId);
        const comment = thread.find((candidate) => String(candidate.id) === String(commentId));
        if (!comment || comment.status !== "active") return { comment_id: commentId, status, changed: false };
        const rootId = comment.root_comment_id || comment.id;
        const hidden = comment.root_comment_id
            ? thread.filter((candidate) => String(candidate.id) === String(comment.id) && candidate.status === "active")
            : thread.filter((candidate) => (String(candidate.id) === String(rootId) || String(candidate.root_comment_id) === String(rootId)) && candidate.status === "active");
        hidden.forEach((candidate) => { candidate.status = status; candidate.body = null; });
        const item = this.commentTargetItem(type, targetId);
        if (item) item.comment_count = Math.max(0, Number(item.comment_count || 0) - hidden.length);
        return { comment_id: commentId, status, changed: true };
    }

    async listPollComments(_userId, targetId, before, limit) { return this.listDemoComments("poll", targetId, before, limit); }
    async getPollComment(_userId, targetId, commentId) { return this.getDemoComment("poll", targetId, commentId); }
    async listPollCommentReplies(_userId, targetId, rootId, after, limit) { return this.listDemoReplies("poll", targetId, rootId, after, limit); }
    async createPollComment(_userId, targetId, body, requestId, parentId) { return this.createDemoComment("poll", targetId, body, requestId, parentId); }
    async setPollCommentReaction(_userId, targetId, commentId, reaction) { return this.mutateDemoCommentReaction("poll", targetId, commentId, reaction); }
    async removePollCommentReaction(_userId, targetId, commentId) { return this.mutateDemoCommentReaction("poll", targetId, commentId, null); }
    async getPollCommentReactors(_userId, targetId, commentId, offset, limit) { return this.getDemoCommentReactors("poll", targetId, commentId, offset, limit); }
    async reportPollComment(_userId, targetId, commentId) { return this.hideDemoComment("poll", targetId, commentId, "reported_hidden"); }
    async deletePollComment(_userId, targetId, commentId) { return this.hideDemoComment("poll", targetId, commentId, "author_deleted"); }
    async listFeedActivityComments(_userId, targetId, before, limit) { return this.listDemoComments("activity", targetId, before, limit); }
    async getFeedActivityComment(_userId, targetId, commentId) { return this.getDemoComment("activity", targetId, commentId); }
    async listFeedActivityCommentReplies(_userId, targetId, rootId, after, limit) { return this.listDemoReplies("activity", targetId, rootId, after, limit); }
    async createFeedActivityComment(_userId, targetId, body, requestId, parentId) { return this.createDemoComment("activity", targetId, body, requestId, parentId); }
    async setFeedActivityCommentReaction(_userId, targetId, commentId, reaction) { return this.mutateDemoCommentReaction("activity", targetId, commentId, reaction); }
    async removeFeedActivityCommentReaction(_userId, targetId, commentId) { return this.mutateDemoCommentReaction("activity", targetId, commentId, null); }
    async getFeedActivityCommentReactors(_userId, targetId, commentId, offset, limit) { return this.getDemoCommentReactors("activity", targetId, commentId, offset, limit); }
    async reportFeedActivityComment(_userId, targetId, commentId) { return this.hideDemoComment("activity", targetId, commentId, "reported_hidden"); }
    async deleteFeedActivityComment(_userId, targetId, commentId) { return this.hideDemoComment("activity", targetId, commentId, "author_deleted"); }

    async revealSender(_userId, answerId) {
        const item = this.personalFeed.find((candidate) => candidate.question_answer_id === answerId);
        if (!this.demoGodMode || !item) throw new Error("God Mode subscription required for reveals.");
        item.voter_name = "Maya Chen";
        item.voter_profile_picture_url = "../assets/app/anonymous.webp";
        if (this.profile.remaining_reveals > 0) this.profile.remaining_reveals -= 1;
        else this.profile.aura_points -= 1000;
        return {
            question_answer_id: answerId,
            full_name: item.voter_name,
            profile_picture_url: item.voter_profile_picture_url,
            remaining_reveals: this.profile.remaining_reveals,
            total_aura_points: this.profile.aura_points,
        };
    }

    async reportQuestion(_userId, questionId) {
        this.personalFeed = this.personalFeed.filter((item) => item.question_id !== questionId);
        this.schoolFeed = this.schoolFeed.filter((item) => item.question_id !== questionId);
        return { message: "Report submitted successfully" };
    }

    async dismissFeedQuestion(_userId, questionId) {
        this.personalFeed = this.personalFeed.filter((item) => item.question_id !== questionId);
        this.schoolFeed = this.schoolFeed.filter((item) => item.question_id !== questionId);
        return { message: "Question dismissed from feed" };
    }

    async blockQuestionSubmitter(_userId, questionId) {
        return this.reportQuestion(_userId, questionId);
    }

    async reportUser(_userId, reportedUserId) {
        return { reported_user_id: reportedUserId };
    }

    async blockUser(_userId, blockedUserId) {
        this.classmates = this.classmates.filter((classmate) => String(classmate.user_id) !== String(blockedUserId));
        return { blocked_user_id: blockedUserId };
    }

    async getPlayQuestions() {
        return { questions: this.questions.map((question) => ({ ...question })) };
    }

    async getConfig() {
        return {
            nomination_aura_cost: 100,
            tbh_request_aura_cost: 100,
            question_submission_aura_cost: 200,
            max_custom_question_length: 280,
            max_skips_per_set: 3,
            play_lock_time_seconds: 60,
            full_reveal_aura_cost: 1000,
            max_full_reveals_per_week: 2,
            god_mode_price: 6.99,
            global_visibility_boost_cost: 400,
            targeted_visibility_boost_cost: 200,
            enable_tbh_requests: true,
            enable_chats: true,
            enable_web_chats: true,
            enable_chat_daily_ledger: true,
            enable_web_mementos: true,
            enable_stories: ["stories", "native-stories"].some((key) => new URLSearchParams(location.search).get(key) === "1"),
            enable_web_stories: new URLSearchParams(location.search).get("stories") === "1",
            enable_calls: this.demoCallsEnabled,
            enable_web_calls: this.demoCallsEnabled,
            enable_web_comments: new URLSearchParams(location.search).get("comments") !== "0",
        };
    }

    storyAuthors() {
        this.demoStoryAuthors ||= [
            { user_id: "demo-user", first_name: "Jules", last_name: "Rivera", username: "jules", profile_picture_url: "../assets/AppIconV2.png", is_owner: true, has_unviewed: false, items: [{ id: "story-jules", media_type: "photo", media_url: "../assets/app/pencil-clipboard.webp", thumbnail_url: null, caption: "Friday energy", text_overlay: "finally ✨", text_overlay_x: 0.5, text_overlay_y: 0.5, published_at: ago(20), expires_at: new Date(Date.now() + 23 * 60 * 60_000).toISOString(), viewer_has_viewed: true, view_count: 2 }] },
            { user_id: "classmate-2", first_name: "Noah", last_name: "Williams", username: "noah", profile_picture_url: "../assets/app/lock.webp", is_owner: false, has_unviewed: true, items: [{ id: "story-noah", media_type: "photo", media_url: "../assets/app/lock.webp", thumbnail_url: null, caption: "Game night", text_overlay: null, text_overlay_x: null, text_overlay_y: null, published_at: ago(5), expires_at: new Date(Date.now() + 23 * 60 * 60_000).toISOString(), viewer_has_viewed: false, view_count: 4 }] },
        ];
        return this.demoStoryAuthors;
    }

    async getStories() { return { authors: structuredClone(this.storyAuthors()), server_time: new Date().toISOString() }; }
    async createStoryUpload(_userId, payload) {
        return {
            media_asset_id: `story-media-${payload.clientRequestId}`,
            upload_url: "data:application/octet-stream,",
            upload_method: "PUT",
            required_headers: { "Content-Type": payload.contentType },
            thumbnail_upload_url: payload.thumbnailSizeBytes ? "data:application/octet-stream," : null,
            thumbnail_required_headers: payload.thumbnailSizeBytes ? { "Content-Type": "image/jpeg" } : null,
            already_finalized: false,
            expires_at: new Date(Date.now() + 300_000).toISOString(),
        };
    }
    async finalizeStoryUpload(_userId, mediaAssetId) { return { media_asset_id: mediaAssetId, state: "ready" }; }
    async publishStory(_userId, mediaAssetId, payload = {}) {
        if (this.demoStoryFailOnce && !localStorage.getItem("valid:demo-story-failed-once")) {
            localStorage.setItem("valid:demo-story-failed-once", "1");
            const error = new Error("Temporary Story outage");
            error.status = 503;
            throw error;
        }
        const id = `story-${payload.clientRequestId}`;
        const owner = this.storyAuthors().find((author) => author.is_owner);
        owner.items.push({
            id,
            media_type: "photo",
            media_url: "/assets/AppIconV2.png",
            thumbnail_url: null,
            video_duration_ms: null,
            caption: payload.caption || null,
            text_overlay: payload.overlay?.text || null,
            text_overlay_x: payload.overlay?.x ?? null,
            text_overlay_y: payload.overlay?.y ?? null,
            published_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
            viewer_has_viewed: true,
            view_count: 0,
            media_asset_id: mediaAssetId,
        });
        return { story_id: id, published_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86_400_000).toISOString() };
    }
    async recordStoryView(_userId, storyId) { const story = this.storyAuthors().flatMap((author) => author.items).find((item) => item.id === storyId); const created = !story.viewer_has_viewed; story.viewer_has_viewed = true; if (created) story.view_count += 1; const author = this.storyAuthors().find((item) => item.items.includes(story)); if (author) author.has_unviewed = author.items.some((item) => !item.viewer_has_viewed); return { story_id: storyId, created }; }
    async getStoryViewers(_userId, storyId) { return { story_id: storyId, viewers: [{ user_id: "classmate-2", first_name: "Noah", last_name: "Williams", username: "noah", profile_picture_url: "../assets/app/lock.webp", viewed_at: ago(2), screenshot_count: 1, last_screenshot_at: ago(1), screen_capture_count: 0, last_screen_capture_at: null }], next_cursor: null }; }
    async deleteStory(_userId, storyId) { for (const author of this.storyAuthors()) author.items = author.items.filter((item) => item.id !== storyId); }
    async reportStory(_userId, storyId) { for (const author of this.storyAuthors()) author.items = author.items.filter((item) => item.id !== storyId); return { story_id: storyId, reported: true }; }

    async getChats() { return { items: structuredClone(this.chats) }; }
    async getChatUnreadCount() { return { unread_count: this.chats.reduce((sum, chat) => sum + Number(chat.unread_count || 0), 0) }; }
    async getChat(_userId, chatId) {
        const chat = this.chats.find((item) => item.id === chatId);
        if (!chat) throw new Error("Chat not found");
        return { chat: structuredClone(chat), members: structuredClone(this.chatMembers[chatId] || []) };
    }
    async createChat(_userId, memberIds, name) {
        const id = `chat-${Date.now()}`;
        const members = this.classmates.filter((person) => memberIds.includes(person.user_id));
        const chat = { id, display_name: name || displayDemoName(members[0]), name: name || null, status: "active", owner_user_id: "demo-user", membership_id: `membership-${id}`, membership_status: "accepted", role: "owner", accepted_count: members.length + 1, pending_count: 0, moment_streak: 0, today_memento_count: 0, today_memento_eligible_count: members.length + 1, has_posted_today_memento: false, is_memento_eligible_today: true, member_cap: 50, unread_count: 0, regular_unread_count: 0, last_room_sequence: 0, last_read_sequence: 0, notification_level: "all", member_previews: members, last_message_body: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        this.chats.unshift(chat);
        this.chatMembers[id] = [{ membership_id: `m-${id}-me`, user_id: "demo-user", role: "owner", status: "accepted", first_name: "Jules", last_name: "Rivera" }, ...members.map((person, index) => ({ membership_id: `m-${id}-${index}`, role: "member", status: "accepted", ...person }))];
        this.chatMessages[id] = [];
        this.dailyRows[id] = { chat_id: id, ledger_date: localLedgerDate(), viewer_has_posted_today: false, viewer_has_shared: false, viewer_is_eligible: true, view_gate_locked: true, posted_count: 0, eligible_count: members.length + 1, entries: [] };
        return structuredClone(chat);
    }
    async acceptChatInvitation(_userId, membershipId) { const chat = this.chats.find((item) => item.membership_id === membershipId); chat.membership_status = "accepted"; chat.status = "active"; this.chatMembers[chat.id] ||= []; this.chatMessages[chat.id] ||= []; return structuredClone(chat); }
    async declineChatInvitation(_userId, membershipId) { this.chats = this.chats.filter((item) => item.membership_id !== membershipId); }
    async inviteChatMembers(_userId, chatId, memberIds) { const chat = this.chats.find((item) => item.id === chatId); const existing = new Set((this.chatMembers[chatId] || []).map((member) => member.user_id)); const people = this.classmates.filter((person) => memberIds.includes(person.user_id) && !existing.has(person.user_id)); this.chatMembers[chatId].push(...people.map((person, index) => ({ membership_id: `m-invite-${Date.now()}-${index}`, role: "member", status: "invited", ...person }))); chat.pending_count += people.length; chat.updated_at = new Date().toISOString(); return structuredClone(chat); }
    async updateChatName(_userId, chatId, name) { const chat = this.chats.find((item) => item.id === chatId); chat.name = name; chat.display_name = name; chat.updated_at = new Date().toISOString(); return structuredClone(chat); }
    async uploadChatPhoto(_userId, chatId) { const chat = this.chats.find((item) => item.id === chatId); chat.chat_photo_url = "../assets/AppIconV2.png"; chat.updated_at = new Date().toISOString(); return structuredClone(chat); }
    async removeChatMember(_userId, chatId, memberId) { const chat = this.chats.find((item) => item.id === chatId); const member = this.chatMembers[chatId].find((item) => item.user_id === memberId); this.chatMembers[chatId] = this.chatMembers[chatId].filter((item) => item.user_id !== memberId); if (member?.status === "invited") chat.pending_count = Math.max(0, chat.pending_count - 1); else chat.accepted_count = Math.max(1, chat.accepted_count - 1); }
    async startCall(_userId, chatId, mediaType, clientRequestId) { const prior = [...this.demoCalls.values()].find((call) => call.client_request_id === clientRequestId); if (prior) return structuredClone(prior); const chat = this.chats.find((item) => item.id === chatId); const now = new Date(); const call = { id: `call-${Date.now()}`, client_request_id: clientRequestId, chat_id: chatId, initiated_by_user_id: "demo-user", media_type: mediaType, state: "ringing", provider: "livekit", caller_name: "Jules", participant_user_ids: (this.chatMembers[chatId] || []).filter((member) => member.status === "accepted").map((member) => member.user_id), viewer_invitation_state: "accepted", participant_limit: 8, camera_publisher_limit: 8, admitted_participant_count: 1, camera_publisher_count: 0, viewer_has_camera_slot: false, ringing_expires_at: new Date(now.getTime() + 45_000).toISOString(), answered_at: null, max_ends_at: null, ended_at: null, end_reason: null, created_at: now.toISOString(), updated_at: now.toISOString(), display_name: chat?.display_name }; this.demoCalls.set(call.id, call); return structuredClone(call); }
    async getCall(_userId, callId) { const call = this.demoCalls.get(callId); if (!call) throw new Error("Call not found"); return structuredClone(call); }
    async acceptCall(_userId, callId) { const call = this.demoCalls.get(callId); Object.assign(call, { state: "active", viewer_invitation_state: "accepted", answered_at: new Date().toISOString() }); return structuredClone(call); }
    async declineCall(_userId, callId) { const call = this.demoCalls.get(callId); Object.assign(call, { state: "declined", viewer_invitation_state: "declined", ended_at: new Date().toISOString() }); return structuredClone(call); }
    async joinCall(_userId, callId) { return { call: await this.getCall(_userId, callId), server_url: "wss://demo.invalid", access_token: "demo", room_name: callId, camera_slot_reserved: false, camera_slot_reservation_id: null }; }
    async enableCallCamera(_userId, callId) { const call = this.demoCalls.get(callId); call.viewer_has_camera_slot = true; call.camera_publisher_count = 1; return { call: structuredClone(call), camera_slot_reserved: true, camera_slot_reservation_id: `camera-${callId}` }; }
    async disableCallCamera(_userId, callId) { const call = this.demoCalls.get(callId); call.viewer_has_camera_slot = false; call.camera_publisher_count = 0; return { call: structuredClone(call), camera_slot_reserved: false, camera_slot_reservation_id: null }; }
    async endCall(_userId, callId) { const call = this.demoCalls.get(callId); Object.assign(call, { state: "ended", ended_at: new Date().toISOString() }); return structuredClone(call); }
    async leaveCall(_userId, callId) { return this.endCall(_userId, callId); }
    async getChatMessages(_userId, chatId, options = {}) { const items = this.chatMessages[chatId] || []; const filtered = options.afterSequence === null || options.afterSequence === undefined ? items : items.filter((item) => item.room_sequence > options.afterSequence); return { items: structuredClone(filtered), next_before_sequence: null, latest_sequence: items.at(-1)?.room_sequence || 0 }; }
    async searchChats(_userId, query, limitPerType = 8) {
        const needle = String(query || "").trim().toLowerCase();
        const chats = this.chats.filter((chat) => chat.display_name.toLowerCase().includes(needle)).slice(0, limitPerType).map((chat) => ({ id: chat.id, result_type: "chat", title: chat.display_name, subtitle: chat.last_message_body, occurred_at: chat.updated_at, chat_id: chat.id, source_context: "chat" }));
        const messages = Object.entries(this.chatMessages).flatMap(([chatId, items]) => items.filter((message) => String(message.body || "").toLowerCase().includes(needle)).map((message) => ({ id: message.id, result_type: "message", title: this.chats.find((chat) => chat.id === chatId)?.display_name || "Chat", snippet: message.body, occurred_at: message.created_at, chat_id: chatId, room_sequence: message.room_sequence, source_context: "message" }))).slice(0, limitPerType);
        return { query: String(query).trim(), chats: { items: chats, next_cursor: null }, messages: { items: messages, next_cursor: null } };
    }
    async sendChatMessage(_userId, chatId, payload) { const messages = this.chatMessages[chatId] || (this.chatMessages[chatId] = []); const prior = messages.find((item) => item.client_request_id === payload.client_request_id); if (prior) return structuredClone(prior); const asset = this.chatMediaAssets[payload.media_asset_id]; const kind = payload.story_id ? "story" : payload.daily_entry_id ? "memento" : payload.sticker_id ? "sticker" : asset?.kind || "text"; const story = payload.story_id ? this.storyAuthors().flatMap((author) => author.items.map((item) => ({ ...item, author }))).find((item) => item.id === payload.story_id) : null; const message = { id: `msg-${Date.now()}`, client_request_id: payload.client_request_id, chat_id: chatId, room_sequence: (messages.at(-1)?.room_sequence || 0) + 1, sender_user_id: "demo-user", sender_first_name: "Jules", kind, body: payload.body || (kind === "memento" ? "Sent a Memento" : null), story_id: payload.story_id || null, story_share_context: payload.story_share_context || null, story_is_available: Boolean(story), story_owner_user_id: story?.author.user_id || null, story_owner_first_name: story?.author.first_name || null, story_owner_username: story?.author.username || null, story_media_type: story?.media_type || null, story_media_url: story?.media_url || null, story_thumbnail_url: story?.thumbnail_url || null, story_video_duration_ms: story?.video_duration_ms || null, story_text_overlay: story?.text_overlay || null, story_text_overlay_x: story?.text_overlay_x || null, story_text_overlay_y: story?.text_overlay_y || null, story_published_at: story?.published_at || null, story_expires_at: story?.expires_at || null, daily_entry_id: payload.daily_entry_id || null, sticker_id: payload.sticker_id || null, sticker_image_url: kind === "sticker" ? "../assets/app/rocket.webp" : null, reply_to_message_id: payload.reply_to_message_id || null, photo_image_url: kind === "photo" && !payload.view_once ? "../assets/AppIconV2.png" : null, video_url: kind === "video" && !payload.view_once ? "../assets/demo.mp4" : null, video_thumbnail_url: kind === "video" && !payload.view_once ? "../assets/AppIconV2.png" : null, audio_url: kind === "audio" ? "../assets/AppIconV2.png" : null, audio_duration_ms: kind === "audio" ? asset?.durationMs || 3_000 : null, view_once: Boolean(payload.view_once), view_once_available: Boolean(payload.view_once), view_once_consumed: false, view_once_remaining_views: payload.view_once ? 2 : 0, view_once_opened_count: 0, view_once_recipient_count: payload.view_once ? 1 : 0, media_text_overlay: payload.media_text_overlay || null, status: "active", viewer_is_sender: true, reaction_count: 0, reaction_summary: {}, current_user_reaction: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; messages.push(message); const chat = this.chats.find((item) => item.id === chatId); Object.assign(chat, { last_room_sequence: message.room_sequence, last_message_body: message.body, last_message_kind: message.kind, last_message_sender_first_name: "Jules", last_message_is_mine: true, last_message_at: message.created_at, updated_at: message.created_at }); return structuredClone(message); }
    async createChatMediaUpload(_userId, options) { const id = `chat-media-${Date.now()}`; this.chatMediaAssets[id] = { kind: options.contentType === "video/mp4" ? "video" : options.contentType === "audio/mp4" ? "audio" : "photo", view_once: options.viewOnce, durationMs: options.durationMs }; return { media_asset_id: id, upload_url: "", thumbnail_upload_url: "", upload_method: "PUT", required_headers: {}, thumbnail_required_headers: {}, already_finalized: true, expires_at: new Date(Date.now() + 900_000).toISOString() }; }
    async finalizeChatMediaUpload(_userId, mediaId) { return { media_asset_id: mediaId, state: "ready" }; }
    async beginChatMediaViewSession(_userId, chatId, options) { const message = this.chatMessages[chatId].find((item) => item.id === options.messageId) || this.chatMessages[chatId].find((item) => item.id === this.chatViewSessions[options.replayOfSessionId]?.message_id); if (!message || !message.view_once_available) throw new Error("This view-once message is no longer available."); const sessionId = `view-${Date.now()}`; this.chatViewSessions[sessionId] = { message_id: message.id, started: false }; return { session_id: sessionId, expires_at: new Date(Date.now() + 60_000).toISOString(), message: { ...structuredClone(message), photo_image_url: message.kind === "photo" ? "../assets/AppIconV2.png" : null, video_url: message.kind === "video" ? "../assets/demo.mp4" : null, video_thumbnail_url: message.kind === "video" ? "../assets/AppIconV2.png" : null } }; }
    async startChatMediaViewSession(_userId, chatId, sessionId) { const session = this.chatViewSessions[sessionId]; const message = this.chatMessages[chatId].find((item) => item.id === session.message_id); if (!session.started) { session.started = true; message.view_once_opened_count += 1; message.view_once_remaining_views = Math.max(0, message.view_once_remaining_views - 1); message.view_once_available = message.view_once_remaining_views > 0; } return { session_id: sessionId, started_at: new Date().toISOString(), newly_started: true, message_id: message.id }; }
    async getChatViewOnceReceipts(_userId, chatId, messageId) { const message = this.chatMessages[chatId].find((item) => item.id === messageId); return { message_id: messageId, opened_count: message.view_once_opened_count || 0, recipient_count: message.view_once_recipient_count || 1, members: [{ user_id: "classmate-2", first_name: "Noah", last_name: "Williams", opened: Number(message.view_once_opened_count || 0) > 0, opened_at: message.view_once_opened_count ? new Date().toISOString() : null, view_count: Number(message.view_once_opened_count || 0) }] }; }
    async getStickers() { return { stickers: [{ id: "sticker-demo", image_url: "../assets/app/rocket.webp", pixel_width: 256, pixel_height: 256, created_at: new Date().toISOString() }] }; }
    async getFeaturedCameraFilters() {
        return {
            filters: [{
                id: "filter-featured-sunset",
                name: "Sunset",
                recipe: {
                    schema_version: 6,
                    render_mode: "live_recipe",
                    saturation: 1.12,
                    contrast: 1.06,
                    brightness: 0.015,
                    wash_opacity: 0.08,
                    vignette_intensity: 0.08,
                    background_style: "original",
                    background_color: "#F29D56",
                    background_secondary_color: "#EF5275",
                    shadow_color: "#F29D56",
                    highlight_color: "#EF5275",
                },
                presentation: { minimum_renderer_version: 3 },
            }],
        };
    }
    async setChatMessageReaction(_userId, chatId, messageId, reaction) { const message = this.chatMessages[chatId].find((item) => item.id === messageId); const previous = message.current_user_reaction; if (previous) message.reaction_summary[previous] = Math.max(0, Number(message.reaction_summary[previous] || 0) - 1); if (reaction) message.reaction_summary[reaction] = Number(message.reaction_summary[reaction] || 0) + 1; message.current_user_reaction = reaction; message.reaction_count = Object.values(message.reaction_summary).reduce((sum, count) => sum + count, 0); return structuredClone(message); }
    async getChatMessageReactors(_userId, chatId, messageId) { const message = this.chatMessages[chatId].find((item) => item.id === messageId); const reactions = Object.entries(message?.reaction_summary || {}).flatMap(([reaction_type, count]) => Array.from({ length: Number(count || 0) }, (_, index) => ({ user_id: `reactor-${reaction_type}-${index}`, first_name: index ? "Ava" : "Maya", last_name: index ? "Patel" : "Chen", reaction_type, reacted_at: new Date().toISOString() }))); return reactions; }
    async unsendChatMessage(_userId, chatId, messageId) { const message = this.chatMessages[chatId].find((item) => item.id === messageId); Object.assign(message, { kind: "tombstone", body: null, status: "deleted_by_author", updated_at: new Date().toISOString() }); return structuredClone(message); }
    async deleteChatMessageForMe(_userId, chatId, messageId) { this.chatMessages[chatId] = this.chatMessages[chatId].filter((item) => item.id !== messageId); }
    async markChatRead(_userId, chatId, sequence) { const chat = this.chats.find((item) => item.id === chatId); Object.assign(chat, { unread_count: 0, regular_unread_count: 0, last_read_sequence: sequence }); return { last_read_sequence: sequence }; }
    async setChatTyping() {}
    async updateChatNotificationLevel(_userId, chatId, level) { const chat = this.chats.find((item) => item.id === chatId); chat.notification_level = level; return structuredClone(chat); }
    async reportChat() {}
    async leaveChat(_userId, chatId) { this.chats = this.chats.filter((item) => item.id !== chatId); }
    async getChatDailyRow(_userId, chatId, ledgerDate = null) {
        const row = structuredClone(this.dailyRows[chatId]);
        if (!row || !ledgerDate || ledgerDate === row.ledger_date) return row;
        row.ledger_date = ledgerDate;
        row.viewer_has_posted_today = false;
        row.viewer_has_shared = true;
        row.view_gate_locked = false;
        return row;
    }
    async skipChatMemento(_userId, chatId) { const row = this.dailyRows[chatId]; row.viewer_has_skipped_today = true; row.view_gate_locked = false; const chat = this.chats.find((item) => item.id === chatId); chat.has_skipped_today_memento = true; return { chat_id: chatId, ledger_date: row.ledger_date, created: true }; }
    async createDailyHighlightUpload(_userId, _sizeBytes, _clientRequestId, secondarySizeBytes = null) { const id = `media-${Date.now()}`; this.dailyMediaAssets[id] = { hasSecondary: Number(secondarySizeBytes || 0) > 0 }; return { media_asset_id: id, upload_url: "", secondary_upload_url: this.dailyMediaAssets[id].hasSecondary ? "" : null, upload_method: "PUT", required_headers: {}, already_finalized: true }; }
    async putDirectUpload() {}
    async finalizeDailyHighlightUpload(_userId, mediaId) { return { media_asset_id: mediaId, state: "ready" }; }
    async publishDailyHighlight(_userId, mediaId, chatIds, caption) {
        if (!Array.isArray(chatIds) || chatIds.length !== 1 || !chatIds[0]) throw new Error("A Memento must be shared to exactly one chat.");
        const entryId = `entry-${Date.now()}`;
        const chatId = chatIds[0];
        const row = this.dailyRows[chatId];
        if (!row) throw new Error("That chat is unavailable.");
        row.viewer_has_posted_today = true;
        row.viewer_has_shared = true;
        row.view_gate_locked = false;
        row.posted_count += 1;
        const swappedImageURL = this.dailyMediaAssets[mediaId]?.hasSecondary ? "../assets/app/anonymous.webp" : null;
        row.entries.push({ user_id: "demo-user", first_name: "Jules", last_name: "Rivera", has_posted: true, entry_id: entryId, caption, image_url: "../assets/AppIconV2.png", swapped_image_url: swappedImageURL, published_at: new Date().toISOString() });
        const chat = this.chats.find((item) => item.id === chatId);
        chat.has_posted_today_memento = true;
        chat.today_memento_count = row.posted_count;
        const message = await this.sendChatMessage(null, chatId, { daily_entry_id: entryId, body: caption || "Sent a Memento", client_request_id: crypto.randomUUID() });
        const savedMessage = this.chatMessages[chatId].find((item) => item.id === message.id);
        Object.assign(savedMessage, { memento_image_url: "../assets/AppIconV2.png", memento_swapped_image_url: swappedImageURL, memento_ledger_date: localLedgerDate() });
        return { entry_id: entryId, ledger_date: localLedgerDate(), shared_chat_ids: [...chatIds], aura_points_earned: 10, total_aura_points: this.profile.aura_points + 10, published_at: new Date().toISOString() };
    }

    async getClassmates() {
        return this.classmates.map((classmate) => ({ ...classmate }));
    }

    async getClassmatesWithMetadata() {
        return {
            classmates: this.classmates.map((classmate) => ({ ...classmate })),
            activeThisWeekCount: 6,
        };
    }

    async getClassmatesStatus() {
        return {
            is_unlocked: this.feedVotesCast >= 3,
            lock_reasons: this.feedVotesCast >= 3 ? [] : ["votes"],
            total_classmates: this.classmates.length,
            joined_users: this.classmates.length,
            required_joined_users: 4,
            votes_cast: this.feedVotesCast,
            required_votes: 3,
        };
    }

    async addContacts(_userId, contacts) {
        return contacts.map((contact) => ({ ...contact, is_six7_user: false }));
    }

    async answerQuestion() {
        this.feedVotesCast = Math.min(3, this.feedVotesCast + 1);
        this.profile.aura_points += 5;
        return {
            id: crypto.randomUUID(),
            aura_points_earned: 5,
            total_aura_points: this.profile.aura_points,
            current_streak: this.profile.current_streak,
            streak_multiplier: this.profile.streak_multiplier,
        };
    }

    async skipQuestion() {
        return { status: "skipped" };
    }

    async submitQuestion(_userId, formData) {
        const questionText = String(formData.get("question_text") || "").trim();
        if (questionText.length < 3) throw new Error("Question is too short");
        this.profile.aura_points -= 200;
        const submission = { id: crypto.randomUUID(), status: "pending", question_text: questionText, image_url: null, aura_spent: 200, is_anonymous: formData.get("include_name") !== "true", submitted_at: new Date().toISOString(), reviewed_at: null, question_id: null, question_is_active: null, vote_count: 0, results_visible: false, results_minimum_votes: 5, vote_results: [], is_duplicate: false };
        this.questionSubmissions.unshift(submission);
        return { ...submission };
    }

    async getQuestionSubmissions(_userId, limit = 100) {
        return structuredClone(this.questionSubmissions.slice(0, Math.min(100, Math.max(1, Number(limit) || 100))));
    }

    async deleteQuestionSubmission(_userId, submissionId) {
        const question = this.questionSubmissions.find((item) => String(item.id) === String(submissionId));
        if (!question) throw new Error("Question submission not found");
        if (question.status === "approved") {
            question.question_is_active = false;
            return { id: question.id, message: "Question deactivated and removed from future school questions. Existing polls and results were kept.", aura_refunded: 0, question_removed_from_school: true };
        }
        this.questionSubmissions = this.questionSubmissions.filter((item) => String(item.id) !== String(submissionId));
        this.profile.aura_points += Number(question.aura_spent) || 0;
        return { id: question.id, message: "Question deleted before approval and removed from review.", aura_refunded: Number(question.aura_spent) || 0, question_removed_from_school: false };
    }

    async purchaseGlobalBoost() {
        if (this.profile.active_global_boost) throw new Error("You already have an active global boost.");
        if (this.profile.aura_points < 400) throw new Error("You need 400 aura for this boost.");
        this.profile.aura_points -= 400;
        this.profile.active_global_boost = { id: crypto.randomUUID(), boost_type: "global", remaining_uses: 10, expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString() };
        return { ...this.profile.active_global_boost };
    }

    async purchaseTargetedBoost(_userId, targetUserId) {
        if (this.profile.active_targeted_boosts.some((boost) => boost.target_user_id === targetUserId)) throw new Error("You already have an active boost for this classmate.");
        if (this.profile.aura_points < 200) throw new Error("You need 200 aura for this boost.");
        this.profile.aura_points -= 200;
        const boost = { id: crypto.randomUUID(), boost_type: "targeted", target_user_id: targetUserId, remaining_uses: 1, expires_at: new Date(Date.now() + 86_400_000).toISOString() };
        this.profile.active_targeted_boosts.push(boost);
        return { ...boost };
    }

    async getInviteStatus() {
        return { ...this.inviteStatus };
    }

    async createInvite() {
        this.inviteStatus.sent_today += 1;
        this.inviteStatus.remaining = Math.max(0, this.inviteStatus.remaining - 1);
        return { share_url: `https://validapp.lol/invite/demo-${Date.now().toString(36)}` };
    }

    async updateBio(_userId, bio) {
        this.profile.bio = bio;
        return { ...this.profile };
    }

    async submitFeedback(feedbackText) {
        return {
            id: `demo-feedback-${Date.now()}`,
            user_id: this.profile.user_id,
            feedback_text: feedbackText,
            created_at: new Date().toISOString(),
            photo_url: null,
            responses: [],
        };
    }

    async getFeedbackHistory(_feedbackId = null) {
        return {
            feedback: [
                {
                    id: "demo-feedback-history",
                    user_id: this.profile.user_id,
                    feedback_text: "Make the active tab easier to spot.",
                    created_at: "2026-09-03T14:00:00Z",
                    notice_type: "feedback_response",
                    report_subject_type: null,
                    responses: [
                        {
                            id: "demo-feedback-response",
                            feedback_id: "demo-feedback-history",
                            response_text: "Thanks — we improved the active navigation state.",
                            created_at: "2026-09-04T16:00:00Z",
                        },
                    ],
                },
            ],
        };
    }

    async updateInformation(_userId, information) {
        Object.assign(this.profile, information);
        const school = [...(this.nearbySchools || []), ...(this.resolvedSchools || [])].find((candidate) => String(candidate.id) === String(information.school_id));
        if (school) this.profile.school_name = school.name;
        return { ...this.profile };
    }

    async uploadProfilePicture(_userId, file) {
        this.profile.profile_picture_url = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => resolve(reader.result), { once: true });
            reader.addEventListener("error", () => reject(new Error("Could not preview that image")), { once: true });
            reader.readAsDataURL(file);
        });
        this.profile.profile_picture_url_thumb = this.profile.profile_picture_url;
        this.profile.profile_picture_url_medium = this.profile.profile_picture_url;
        return { url: this.profile.profile_picture_url };
    }

    async getAskLink() {
        return { ...this.askLink };
    }

    async getProfileAskTarget(userId) {
        if (this.profileAskTargetUnavailable) {
            const error = new Error("Ask link unavailable");
            error.status = 404;
            throw error;
        }
        const classmate = this.classmates.find((item) => String(item.user_id) === String(userId));
        if (!classmate?.ask_link_active) {
            const error = new Error("Ask link unavailable");
            error.status = 404;
            throw error;
        }
        return { public_token: `demo-${classmate.username}` };
    }

    async setAskLinkActive(_userId, isActive) {
        this.askLink.is_active = isActive;
        return { ...this.askLink };
    }

    async rotateAskLink() {
        this.askLink.share_url = `https://validapp.lol/a/demo-${Date.now().toString(36)}`;
        return { ...this.askLink };
    }

    async getAnonymousAskAccess() {
        return { ...this.askAccess };
    }

    async getAnonymousAskSafetyNotices(_userId, includeAcknowledged = false) {
        const notices = includeAcknowledged
            ? this.askSafetyNotices
            : this.askSafetyNotices.filter((notice) => !notice.acknowledged_at);
        return structuredClone(notices);
    }

    async acknowledgeAnonymousAskSafetyNotice(_userId, noticeId) {
        const notice = this.askSafetyNotices.find((item) => item.id === noticeId);
        if (notice) notice.acknowledged_at ||= new Date().toISOString();
    }

    async trackAskShare(_userId, platform = "other") {
        return {
            id: `demo-ask-share-${Date.now()}`,
            platform,
            share_url: this.askLink.share_url,
            created_at: new Date().toISOString(),
        };
    }

    async createGodModeCheckout() {
        return { id: "cs_demo", url: "https://checkout.stripe.com/demo" };
    }

    async confirmGodModeCheckout() {
        return { completed: false, subscribed: false };
    }

    async unsubscribeFromGodMode() {
        return {
            provider: "stripe",
            cancel_at_period_end: true,
            subscription_expires_at: ago(-4 * 24 * 60),
        };
    }

    async getAnonymousInbox() {
        return structuredClone(this.anonymousInbox);
    }

    async getTbhRequestTargets(_userId, search = "") {
        const query = String(search).trim().toLowerCase();
        return { items: structuredClone(this.tbhTargets.filter((target) => !query || `${target.first_name} ${target.last_name}`.toLowerCase().includes(query))), next_cursor: null };
    }

    async createTbhRequest(_userId, recipientUserId, promptKey) {
        if (this.profile.aura_points < 100) throw new Error("You need more aura to request a TBH.");
        const target = this.tbhTargets.find((item) => item.user_id === recipientUserId);
        if (!target || target.state !== "eligible") throw new Error("This classmate is not available right now.");
        this.profile.aura_points -= 100;
        target.state = "active";
        const request = { id: `tbh-request-${Date.now()}`, requester_user_id: "demo-user", recipient_user_id: recipientUserId, requester_first_name: "Jules", requester_last_name: "Rivera", requester_username: "jules", requester_profile_picture_url: this.profile.profile_picture_url, prompt_key: promptKey, status: "pending", aura_spent: 100, created_at: new Date().toISOString(), expires_at: ago(-10_000), snoozed_until: null, snooze_count: 0, opened_at: null };
        return { request, aura_spent: 100, total_aura_points: this.profile.aura_points };
    }

    async getPendingTbhRequests() { return { items: structuredClone(this.tbhPending), actionable_count: this.tbhPending.length, snoozed_count: 0, next_cursor: null }; }
    async openTbhRequest(_userId, requestId) { const request = this.tbhPending.find((item) => item.id === requestId); if (request) request.opened_at ||= new Date().toISOString(); }
    async dismissTbhRequest(_userId, requestId) { this.tbhPending = this.tbhPending.filter((item) => item.id !== requestId); }
    async suppressTbhRequester(_userId, requesterId) { this.tbhPending = this.tbhPending.filter((item) => item.requester_user_id !== requesterId); }
    async respondToTbhRequest(_userId, requestId, body) {
        const request = this.tbhPending.find((item) => item.id === requestId);
        if (!request) throw new Error("This TBH request is no longer available.");
        const response = { id: `tbh-response-${Date.now()}`, request_id: requestId, body, prompt_key: request.prompt_key, author_user_id: "demo-user", author_first_name: "Jules", author_last_name: "Rivera", author_username: "jules", author_profile_picture_url: this.profile.profile_picture_url, created_at: new Date().toISOString(), opened_at: null, activity_id: `activity-${Date.now()}`, reaction_count: 0, reaction_summary: {}, current_user_reaction: null, can_react: true };
        this.tbhPending = this.tbhPending.filter((item) => item.id !== requestId);
        return structuredClone(response);
    }
    async getTbhInbox() { return { items: structuredClone(this.tbhInbox) }; }
    async getSentTbhs() { return { items: structuredClone(this.tbhSent) }; }
    async getTbhSchoolFeed(_userId, sort = "recent") {
        const items = structuredClone(this.tbhSchool);
        if (sort === "hottest") items.sort((left, right) => Number(right.reaction_count || 0) - Number(left.reaction_count || 0));
        return { items };
    }
    async getTbhResponse(_userId, responseId) {
        const response = this.tbhInbox.find((item) => item.id === responseId);
        if (!response) throw new Error("TBH not found");
        response.opened_at ||= new Date().toISOString();
        return structuredClone(response);
    }

    async openAnonymousQuestion(_userId, questionId) {
        const question = this.anonymousInbox.questions.find((item) => item.id === questionId);
        if (!question) throw new Error("Question not found");
        question.opened_at ||= new Date().toISOString();
        return { ...question };
    }

    async answerAnonymousQuestion(_userId, questionId, answerText) {
        const question = this.anonymousInbox.questions.find((item) => item.id === questionId);
        if (!question) throw new Error("Question not found");
        const isFirstAnswer = question.status !== "answered";
        question.status = "answered";
        question.answer_text = answerText;
        question.answered_at ||= new Date().toISOString();
        question.aura_points_earned = isFirstAnswer ? 10 : 0;
        if (isFirstAnswer) this.profile.aura_points += 10;
        return { ...question };
    }

    async reportAnonymousQuestion(_userId, questionId, _reason = "other") {
        this.anonymousInbox.questions = this.anonymousInbox.questions.filter((item) => item.id !== questionId);
    }

    async blockAnonymousQuestion(_userId, questionId) {
        this.anonymousInbox.questions = this.anonymousInbox.questions.filter((item) => item.id !== questionId);
    }

    async deleteAnonymousQuestion(_userId, questionId) {
        this.anonymousInbox.questions = this.anonymousInbox.questions.filter((item) => item.id !== questionId);
    }

    async requestAccountDeletion() {
        const requestedAt = new Date();
        const scheduledFor = new Date(requestedAt.getTime() + 5 * 86_400_000);
        this.deletionRequestedAt = requestedAt.toISOString();
        this.user.deletion_requested_at = this.deletionRequestedAt;
        return {
            message: "Account deletion scheduled.",
            requested_at: requestedAt.toISOString(),
            scheduled_for: scheduledFor.toISOString(),
        };
    }

    async cancelAccountDeletion() {
        this.deletionRequestedAt = null;
        this.user.deletion_requested_at = null;
        return { message: "Account deletion cancelled." };
    }

}
