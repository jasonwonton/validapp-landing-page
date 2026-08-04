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
        this.token = null;
        this.user = null;
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
            aura_points: 1280,
            vote_count: 84,
            weekly_vote_count: 16,
            current_streak: 7,
            profile_picture_url: "../assets/AppIconV2.png",
            profile_picture_url_thumb: "../assets/AppIconV2.png",
            profile_picture_url_medium: "../assets/AppIconV2.png",
            can_change_information: true,
            next_information_change_at: null,
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
                question_answer_id: 9001,
                voted_for_name: "Jules",
                voter_gender: "female",
                voter_grade: "Sophomore",
                upvote_count: 12,
                user_has_upvoted: false,
            },
            {
                item_type: "received_vote",
                timestamp: ago(95),
                question_id: 102,
                question_text: "Who would make the best podcast host?",
                question_answer_id: 9002,
                voted_for_name: "Jules",
                voter_gender: "male",
                voter_grade: "Senior",
                upvote_count: 7,
                user_has_upvoted: true,
            },
        ];
        this.schoolFeed = [
            {
                item_type: "school_activity",
                timestamp: ago(3),
                question_id: 103,
                question_text: "Who has the best music taste?",
                question_answer_id: 9003,
                voted_for_name: "Maya Chen",
                voted_for_profile_picture_url: "../assets/app/anonymous.png",
                voter_gender: "female",
                voter_grade: "Junior",
                upvote_count: 19,
                user_has_upvoted: false,
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
                upvote_count: 5,
                user_has_upvoted: false,
            },
        ];
        this.questions = [
            { id: 201, question_text: "Who would survive longest on a deserted island?", image_url: "../assets/app/lock.png" },
            { id: 202, question_text: "Who should plan the senior trip?", image_url: "../assets/app/pencil-clipboard.png", is_user_submitted: true, is_anonymous: false, submitted_by_name: "Maya Chen", submitted_by_avatar_url: "../assets/app/anonymous.png" },
            { id: 203, question_text: "Who gives the best advice?", image_url: "../assets/app/anonymous.png" },
            { id: 204, question_text: "Who is secretly the funniest person here?", image_url: "../assets/AppIconV2.png" },
        ];
        this.classmates = [
            { user_id: "classmate-1", first_name: "Maya", last_name: "Chen", profile_picture_url: "../assets/app/anonymous.png" },
            { user_id: "classmate-2", first_name: "Noah", last_name: "Williams", profile_picture_url: "../assets/app/lock.png" },
            { user_id: "classmate-3", first_name: "Ava", last_name: "Patel", profile_picture_url: "../assets/app/pencil-clipboard.png" },
            { user_id: "classmate-4", first_name: "Eli", last_name: "Brooks", profile_picture_url: "../assets/AppIconV2.png" },
            { user_id: "classmate-5", first_name: "Sofia", last_name: "Kim", profile_picture_url: "../assets/app/aura.png" },
            { user_id: "classmate-6", first_name: "Mateo", last_name: "Lee", profile_picture_url: "../assets/valid_logo.png" },
        ];
        this.inviteStatus = { limit: 3, sent_today: 1, remaining: 2, next_reset_at: ago(-720), qualifying_invites: 0, aura_reward_progress: 0, aura_reward_goal: 3, aura_reward_amount: 50, aura_rewards_claimed: 0, aura_rewards_max: 1, aura_reward_max_reached: false };
        this.askLink = {
            share_url: "https://validapp.lol/a/jules-demo",
            is_active: true,
        };
    }

    hasSession() {
        return Boolean(this.token && this.user?.id);
    }

    async demoLogin() {
        assertLocalDemo();
        return {
            access_token: "local-demo-memory-only",
            user: { id: "demo-user" },
        };
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

    async getProfile() {
        return { ...this.profile };
    }

    async getTopQuestions(_userId, period = "weekly", limit = 10) {
        return (this.topQuestions[period] || []).slice(0, limit).map((question) => ({ ...question }));
    }

    async getPersonalFeed(_userId, offset = 0) {
        return offset ? [] : this.personalFeed.map((item) => ({ ...item }));
    }

    async getSchoolFeed(_userId, cursor = null) {
        return cursor ? [] : this.schoolFeed.map((item) => ({ ...item }));
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

    async getPlayQuestions() {
        return { questions: this.questions.map((question) => ({ ...question })) };
    }

    async getClassmates() {
        return this.classmates.map((classmate) => ({ ...classmate }));
    }

    async answerQuestion() {
        this.profile.aura_points += 5;
        return { id: crypto.randomUUID() };
    }

    async skipQuestion() {
        return { status: "skipped" };
    }

    async submitQuestion(_userId, formData) {
        const questionText = String(formData.get("question_text") || "").trim();
        if (questionText.length < 3) throw new Error("Question is too short");
        return { id: crypto.randomUUID(), status: "pending" };
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

    async updateInformation(_userId, information) {
        Object.assign(this.profile, information);
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

    async setAskLinkActive(_userId, isActive) {
        this.askLink.is_active = isActive;
        return { ...this.askLink };
    }

    async rotateAskLink() {
        this.askLink.share_url = `https://validapp.lol/a/demo-${Date.now().toString(36)}`;
        return { ...this.askLink };
    }

    async trackAskShare() {
        return { status: "tracked" };
    }

}
