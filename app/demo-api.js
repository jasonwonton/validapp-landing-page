const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function assertLocalDemo() {
    if (!LOCAL_HOSTS.has(window.location.hostname)) {
        throw new Error("The Valid demo is available only on localhost.");
    }
}

function ago(minutes) {
    return new Date(Date.now() - minutes * 60_000).toISOString();
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
                image_url: "../assets/app/pencil-clipboard.png",
                question_answer_id: 9001,
                voted_for_name: "Jules",
                voter_gender: "female",
                voter_grade: "Sophomore",
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
            },
            {
                item_type: "received_vote",
                timestamp: ago(95),
                question_id: 102,
                question_text: "Who would make the best podcast host?",
                image_url: "../assets/app/lock.png",
                question_answer_id: 9002,
                voted_for_name: "Jules",
                voter_gender: "male",
                voter_grade: "Senior",
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
            },
        ];
        this.schoolFeed = [
            {
                item_type: "school_activity",
                timestamp: ago(3),
                question_id: 103,
                question_text: "Who has the best music taste?",
                image_url: "../assets/app/anonymous.png",
                question_answer_id: 9003,
                voted_for_name: "Maya Chen",
                voted_for_profile_picture_url: "../assets/app/anonymous.png",
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
            },
            {
                item_type: "school_activity",
                timestamp: ago(42),
                question_id: 104,
                question_text: "Who is most likely to start a company?",
                question_answer_id: 9004,
                voted_for_name: "Noah Williams",
                voted_for_profile_picture_url: "../assets/app/lock.png",
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
            },
        ];
        this.questions = [
            { id: 201, question_text: "Who would survive longest on a deserted island?", image_url: "../assets/app/lock.png" },
            { id: 202, question_text: "Who should plan the senior trip?", image_url: "../assets/app/pencil-clipboard.png", is_user_submitted: true, is_anonymous: false, submitted_by_name: "Maya Chen", submitted_by_avatar_url: "../assets/app/anonymous.png" },
            { id: 203, question_text: "Who gives the best advice?", image_url: "../assets/app/anonymous.png" },
            { id: 204, question_text: "Who is secretly the funniest person here?", image_url: "../assets/AppIconV2.png" },
        ];
        this.classmates = [
            { user_id: "classmate-1", first_name: "Maya", last_name: "Chen", username: "maya_c", grade: "Senior", school_name: "Westview High School", bio: "Student council and bad puns.", vote_count: 61, weekly_vote_count: 22, ask_link_active: true, profile_picture_url: "../assets/app/anonymous.png" },
            { user_id: "classmate-2", first_name: "Noah", last_name: "Williams", username: "noahw", grade: "Sophomore", school_name: "Westview High School", vote_count: 44, weekly_vote_count: 19, profile_picture_url: "../assets/app/lock.png" },
            { user_id: "classmate-3", first_name: "Ava", last_name: "Patel", username: "avap", grade: "Junior", school_name: "Westview High School", vote_count: 39, weekly_vote_count: 14, profile_picture_url: "../assets/app/pencil-clipboard.png" },
            { user_id: "classmate-4", first_name: "Eli", last_name: "Brooks", username: "elib", grade: "Junior", school_name: "Westview High School", vote_count: 31, weekly_vote_count: 11, profile_picture_url: "../assets/AppIconV2.png" },
            { user_id: "classmate-5", first_name: "Sofia", last_name: "Kim", username: "sofiak", grade: "Freshman", school_name: "Westview High School", vote_count: 27, weekly_vote_count: 9, profile_picture_url: "../assets/app/aura.png" },
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
                    recipient_profile_picture_url: "../assets/app/anonymous.png",
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
            requester_profile_picture_url: "../assets/app/anonymous.png", prompt_key: "your_vibe", status: "pending",
            aura_spent: 100, created_at: ago(6), expires_at: ago(-10_000), snoozed_until: null, snooze_count: 0, opened_at: null,
        }];
        this.tbhInbox = [{
            id: "tbh-response-1", request_id: "answered-request-1", body: "You make every group project more fun, and you always notice when someone needs help.", prompt_key: "best_quality",
            author_user_id: "classmate-2", author_first_name: "Noah", author_last_name: "Williams", author_username: "noahw", author_profile_picture_url: "../assets/app/lock.png",
            created_at: ago(25), opened_at: null, activity_id: "activity-tbh-1", reaction_count: 4, reaction_summary: { love: 3, fire: 1 }, current_user_reaction: null, can_react: true,
        }];
        this.tbhSent = [{
            id: "tbh-response-2", request_id: "answered-request-2", body: "Your energy is calm until the music starts, then you become the whole party.", prompt_key: "your_vibe",
            subject_user_id: "classmate-4", subject_first_name: "Eli", subject_last_name: "Brooks", subject_profile_picture_url: "../assets/AppIconV2.png",
            created_at: ago(70), activity_id: "activity-tbh-2", reaction_count: 2, reaction_summary: { funny: 2 }, current_user_reaction: "funny", can_react: true,
        }];
        this.tbhSchool = [
            { ...this.tbhInbox[0], subject_user_id: "demo-user", subject_first_name: "Jules", subject_last_name: "Rivera", subject_profile_picture_url: "../assets/AppIconV2.png", author_gender: "male", author_grade: "Sophomore" },
            { ...this.tbhSent[0], author_gender: "female", author_grade: "Junior" },
        ];
        this.reactors = {
            "9001": [{ user_id: "classmate-1", first_name: "Maya", last_name: "Chen", profile_picture_url: "../assets/app/anonymous.png", reaction_type: "love", reacted_at: ago(4) }],
            "activity-tbh-1": [{ user_id: "classmate-4", first_name: "Eli", last_name: "Brooks", profile_picture_url: "../assets/AppIconV2.png", reaction_type: "fire", reacted_at: ago(8) }],
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

    async revealSender(_userId, answerId) {
        const item = this.personalFeed.find((candidate) => candidate.question_answer_id === answerId);
        if (!this.demoGodMode || !item) throw new Error("God Mode subscription required for reveals.");
        item.voter_name = "Maya Chen";
        item.voter_profile_picture_url = "../assets/app/anonymous.png";
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
        };
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
        return { id: crypto.randomUUID(), status: "pending", aura_spent: 200, is_duplicate: false };
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
