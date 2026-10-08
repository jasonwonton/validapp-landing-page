// Play answer choices built like the iOS app: uploaded contacts plus
// classmates, one pool, four weighted picks per question.
//
// Sources (six7 repo, ios/Six7/Six7):
// - ViewModels/PlayViewModel/PlayViewModel+Contacts.swift combineAndDeduplicateChoices
// - ViewModels/PlayViewModel/PlayViewModel+ChoiceSelection.swift selectWeightedRandomChoices
// - ViewModels/PlayViewModel/PlayViewModel+QuestionLoading.swift (the 4-person gate runs
//   before GET /questions/unanswered, because serving questions starts the play lock)
// - ViewModels/PlayViewModel/PlayViewModel+Answering.swift (vote payload)
// - Services/Contacts/ContactFiltering.swift (names kept out of Play and uploads)
// - Packages/Six7Core/.../PhoneNumberFormatter.swift (upload phone format)
//
// One web difference: iOS narrows server contacts to those still visible in
// the device address book and collapses a person's numbers by device contact.
// A browser has no address book, so the web uses every uploaded contact and
// collapses a non-user's numbers by visible name instead.

export const PLAY_CHOICE_COUNT = 4;

// /config defaults (app/models/schemas.py ConfigResponse); the live /config wins.
export const DEFAULT_PLAY_TUNING = Object.freeze({
    enable_recent_choice_cooldown: true,
    recent_history_limit: 8,
    enable_single_gender_polls: true,
    single_gender_poll_chance: 0.2,
    pity_screen_chance: 0.15,
    enable_cross_gender_bias: true,
    cross_gender_multiplier: 1.3,
    contact_weight: 4,
    classmate_weight: 20,
    friend_multiplier_base: 3,
    friend_multiplier_growth: 0.05,
    mutual_strength_multiplier: 10,
    mutual_strength_cap: 50,
    same_grade_weight: 4,
    one_grade_gap_weight: 2,
    distant_grade_weight: 1,
    global_boost_multiplier_base: 3,
    global_boost_multiplier_growth: 0.05,
    targeted_boost_multiplier_base: 60,
    targeted_boost_multiplier_growth: 0.35,
});

// MARK: - Contact name filtering (ContactFiltering.swift)

const FAMILY_TERMS = new Set([
    "mom", "mommy", "mother", "mama", "mami", "mamis", "mamita", "mamacita",
    "mummy", "mum", "momma", "moms", "mamma", "maman", "mutter", "mamae", "madre",
    "dad", "daddy", "father", "papa", "dada", "dads", "pa", "pops", "pop",
    "popsss", "poppa", "poppy", "pappy", "papaw", "pawpaw", "papi", "papai",
    "vater", "padre", "mere", "pere",
    "grandma", "grandmother", "grandmom", "grandmommy", "grandmama", "grandmamma",
    "granny", "gramma", "grammy", "grammie", "nanna", "nana", "gram", "grams",
    "gramsssss",
    "gma", "meemaw", "memaw", "mamaw", "mema", "mimi", "nonna", "oma",
    "abuela", "abuelita",
    "grandpa", "grandfather", "grandad", "granddad", "grandaddy", "granddaddy",
    "grandpop", "grandpops",
    "grandpap", "gramps", "poppop", "gpa", "peepaw", "pepaw", "nonno", "opa",
    "abuelo", "abuelito",
    "aunt", "aunti", "auntie", "aunty", "aunts", "titi", "tia",
    "uncle", "unc", "unk", "tio",
    "cousin", "cuz",
    "niece", "nephew",
    "sister", "sis", "sissy",
    "brother", "bro",
    "stepmom", "stepdad", "stepmother", "stepfather",
    "mother in law", "father in law",
    "brother in law", "sister in law",
    "godmother", "godfather",
    "nanny", "babysitter", "comadre", "compadre",
]);

const PARENT_GRANDPARENT_ANYWHERE_TERMS = new Set([
    "mom", "mommy", "mother", "mama", "mami", "mamis", "mamita", "mamacita",
    "mummy", "mum", "momma", "moms", "mamma", "maman", "mutter", "mamae", "madre",
    "dad", "daddy", "father", "dada", "dads", "papai", "vater", "padre", "mere", "pere",
    "grandma", "grandpa", "gma", "gpa", "pops",
    "aunt", "aunti", "auntie", "aunty", "aunts", "uncle", "cousin", "niece", "nephew",
    "sister", "sis", "sissy", "brother", "bro",
    "stepmom", "stepdad", "stepmother", "stepfather", "godmother", "godfather",
    "nanny", "babysitter", "comadre", "compadre",
    "parent", "parents", "guardian", "adult", "husband", "wife", "spouse",
]);

const FAMILY_PHRASES = new Set([
    "step mom", "step mother", "step dad", "step father",
    "grand ma", "grand mom", "grand mommy", "grand mama", "grand mamma",
    "grand mother", "grand pa", "grand dad", "grand father", "grand pop",
    "grand pops", "grand pap",
    "great aunt", "great uncle", "great grandma", "great grandmother",
    "great grandmom", "great grandpa", "great grandfather", "great granddad",
    "great grandad", "great gma", "great gpa",
    "g ma", "g mom", "g mommy", "g mama", "g pa", "g dad", "g pops",
    "pop pop", "pa pa", "paw paw",
    "ba ngoai", "ba noi", "ong ngoai", "ong noi",
    "mother in law", "father in law",
    "brother in law", "sister in law",
]);

const SERVICE_PHRASES = new Set([
    "voice mail", "voicemail", "voice mailbox", "mailbox", "vmail",
    "warranty center", "vz roadside assistance", "roadside assistance",
    "customer service", "customer support", "support", "help desk", "tech support",
    "spam risk", "scam likely", "no caller id", "unknown caller", "unknown", "anonymous",
    "emergency", "911", "police", "sheriff", "fire department",
    "home phone", "house phone", "work phone", "family phone", "emergency contact",
]);

const BUSINESS_TERMS = new Set([
    "doctor", "dr", "mr", "mrs", "ms", "dentist", "orthodontist", "clinic", "hospital",
    "pharmacy", "office", "cleaning", "cleaner", "housekeeper", "maid", "plumber",
    "electrician", "mechanic", "landlord", "realtor", "bank", "insurance", "salon",
    "barber", "restaurant", "pizza", "uber", "lyft", "doordash", "instacart",
    "attendance", "counselor", "school nurse", "coach", "pastor", "poison", "teacher",
    "principal",
]);

const LOCALLY_EXCLUDED_TERMS = new Set([
    "mami", "pap", "kid", "best", "miss", "mis", "my", "mother", "mumma", "mummm",
    "manager", "supervisor", "therapist", "plug", "practice", "work", "cell", "hot",
    "elementary", "old", "school", "boss", "bestie", "neighbor", "neighbour", "landline",
]);

const LOCALLY_EXCLUDED_PHRASES = new Set(["cash app", "old phone"]);

const LOCALLY_EXCLUDED_REGEXES = [
    /(?:^| )(?:m+o+m+(?:m+y+|m+a+)?|m+u+m+(?:m+y+|m+a+)?|m+a+m+(?:a+|m+a+)?|d+a+d+(?:d+y+|u+h+)?|grand+p+a+|grand+m+a+|a+u+n+t+(?:i+e+)?|u+n+c+l+e+)(?: |$)/i,
    /(?:^| )(?:b+e+s+t+(?:i+e+|e+)|f+r+i+e+n+d{2,})(?: |$)/i,
    /^(?:home|family|someone|somebody|contact|classmate)$/i,
];

const ALPHANUMERIC = /[\p{L}\p{M}\p{N}]/u;

function normalizeFilterName(name) {
    // Case, diacritic and width folding like String.folding(...) in Swift.
    const folded = String(name).trim().normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    let phrase = "";
    let compact = "";
    for (const character of folded) {
        if (ALPHANUMERIC.test(character)) {
            phrase += character;
            compact += character;
        } else {
            phrase += " ";
        }
    }
    phrase = phrase.replace(/\s+/g, " ").trim();
    return { phrase, tokens: phrase ? phrase.split(" ") : [], compact };
}

function startsWithPhrase(phrases, phrase) {
    for (const candidate of phrases) {
        if (phrase === candidate || phrase.startsWith(`${candidate} `)) return true;
    }
    return false;
}

function containsPhrase(phrases, phrase) {
    const padded = ` ${phrase} `;
    for (const candidate of phrases) {
        if (padded.includes(` ${candidate} `)) return true;
    }
    return false;
}

const compiledRuleCache = new WeakMap();

function dynamicRules(rules) {
    if (!rules || typeof rules !== "object") return { terms: new Set(), phrases: new Set(), regexes: [] };
    if (compiledRuleCache.has(rules)) return compiledRuleCache.get(rules);
    const literal = (values) => new Set((Array.isArray(values) ? values : []).slice(0, 100)
        .map((value) => normalizeFilterName(String(value ?? "")).phrase)
        .filter((value) => value && value.length <= 80));
    const patterns = [...new Set((Array.isArray(rules.excluded_regexes) ? rules.excluded_regexes : [])
        .map((value) => String(value ?? "").trim())
        .filter((value) => value && value.length <= 200))].slice(0, 25);
    const regexes = [];
    for (const pattern of patterns) {
        try { regexes.push(new RegExp(pattern, "i")); } catch (_) { /* iOS skips invalid patterns too */ }
    }
    const compiled = { terms: literal(rules.excluded_terms), phrases: literal(rules.excluded_phrases), regexes };
    compiledRuleCache.set(rules, compiled);
    return compiled;
}

/** ContactFiltering.shouldExclude(name:): true keeps a name out of Play and uploads. */
export function shouldExcludeContactName(name, rules = null) {
    if (name === null || name === undefined) return true;
    const normalized = normalizeFilterName(name);
    const { phrase, tokens, compact } = normalized;
    if (!phrase) return true;
    if (!compact || /^\p{N}+$/u.test(compact)) return true;
    if (/[0-9]/.test(phrase)) return true;
    for (const character of phrase) {
        if (/\p{L}/u.test(character) && !/[a-z]/.test(character)) return true;
    }
    if (tokens.length > 2) return true;
    if (containsPhrase(SERVICE_PHRASES, phrase)) return true;
    if (startsWithPhrase(FAMILY_PHRASES, phrase)) return true;
    if (tokens[0] && FAMILY_TERMS.has(tokens[0])) return true;
    if (containsPhrase(PARENT_GRANDPARENT_ANYWHERE_TERMS, phrase)) return true;
    if (tokens.length >= 2 && tokens[0] === "my" && FAMILY_TERMS.has(tokens[1])) return true;
    if (tokens.length >= 2 && tokens[0] === "my" && startsWithPhrase(FAMILY_PHRASES, tokens.slice(1).join(" "))) return true;
    if (containsPhrase(BUSINESS_TERMS, phrase)) return true;
    if (containsPhrase(LOCALLY_EXCLUDED_TERMS, phrase)) return true;
    if (containsPhrase(LOCALLY_EXCLUDED_PHRASES, phrase)) return true;
    if (LOCALLY_EXCLUDED_REGEXES.some((regex) => regex.test(phrase))) return true;
    const dynamic = dynamicRules(rules);
    if (containsPhrase(dynamic.terms, phrase)) return true;
    if (containsPhrase(dynamic.phrases, phrase)) return true;
    return dynamic.regexes.some((regex) => regex.test(phrase));
}

// MARK: - Names and phones

/** ContactMatching.cleanedNameKey: what two option buttons would both show. */
export function cardNameKey(name) {
    return String(name ?? "")
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N}\s'\-.,]/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .split(/\s+/)
        .filter(Boolean)
        .join(" ");
}

const HASHED_PHONE = /^[0-9a-f]{64}$/i;

export function isHashedPhone(value) {
    return HASHED_PHONE.test(String(value ?? ""));
}

/**
 * PhoneNumberFormatter.formatToE164: 10 digits, or 11 starting with 1, become
 * +1XXXXXXXXXX; everything else (extensions, short codes, international) is
 * not uploaded. The server hashes the number with its own secret salt.
 */
export function formatContactPhone(raw) {
    const digits = String(raw ?? "").normalize("NFKC").replace(/\D/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return null;
}

function pickerName(contact) {
    const names = Array.isArray(contact?.name) ? contact.name : [contact?.name];
    for (const name of names) {
        const trimmed = String(name ?? "").trim();
        if (trimmed) return trimmed;
    }
    return "";
}

/**
 * Turns Contact Picker results into POST /users/{id}/contacts rows the way
 * ContactService.swift builds them: every number on the card, one row each,
 * names the filter rejects left out. Returns the rows and why others were dropped.
 */
export function contactUploadPayload(selectedContacts, rules = null) {
    const rows = new Map();
    // Which picked contact (by index) each number belongs to, for counting people.
    const owners = new Map();
    let filteredNames = 0;
    let unusableNumbers = 0;
    for (const [index, contact] of (selectedContacts || []).entries()) {
        const name = pickerName(contact);
        const phones = (Array.isArray(contact?.tel) ? contact.tel : [contact?.tel]).filter((phone) => String(phone ?? "").trim());
        if (shouldExcludeContactName(name, rules)) {
            filteredNames += 1;
            continue;
        }
        let usable = 0;
        for (const phone of phones) {
            const formatted = formatContactPhone(phone);
            if (!formatted) continue;
            usable += 1;
            rows.set(formatted, { phone_number: formatted, name });
            owners.set(formatted, index);
        }
        if (!usable) unusableNumbers += 1;
    }
    return { contacts: [...rows.values()], owners, filteredNames, unusableNumbers };
}

// MARK: - Pool (combineAndDeduplicateChoices)

function profileName(profile) {
    return [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || profile?.username || "Valid user";
}

function contactPhoneKey(contact) {
    const hashed = contact?.hashed_phone_number || (isHashedPhone(contact?.phone_number) ? contact.phone_number : "");
    if (hashed) return String(hashed).toLowerCase();
    const formatted = formatContactPhone(contact?.phone_number);
    return formatted ? formatted.slice(-10) : null;
}

/**
 * One pool of people who can appear on a card. Contacts come first, then
 * classmates; a contact who is also a classmate becomes one classmate entry
 * that keeps the contact's phone. Self and blocked users are removed.
 */
export function buildChoicePool({ contacts = [], classmates = [], selfUserId = null, blockedUserIds = [], filterRules = null } = {}) {
    const self = selfUserId ? String(selfUserId) : "";
    const blocked = new Set([...blockedUserIds].map(String));
    const pool = [];
    const indexByUserId = new Map();
    const seenPhoneKeys = new Set();
    const seenUserIds = new Set();
    const contactNameKeys = new Map();

    for (const contact of contacts || []) {
        const userId = contact?.user_id ? String(contact.user_id) : null;
        if (userId && userId === self) continue;
        if (shouldExcludeContactName(contact?.name, filterRules)) continue;
        const phoneKey = contactPhoneKey(contact);
        if (phoneKey) {
            if (seenPhoneKeys.has(phoneKey)) continue;
            seenPhoneKeys.add(phoneKey);
        } else if (userId) {
            if (seenUserIds.has(userId)) continue;
        } else continue;
        if (userId && indexByUserId.has(userId)) continue;
        const name = String(contact.name || "").trim();
        // Web only: a non-user saved under two numbers is one person.
        const nameKey = cardNameKey(name);
        if (!userId && nameKey && contactNameKeys.has(nameKey)) continue;
        const phone = contact.hashed_phone_number || contact.phone_number || "";
        const choice = {
            id: userId || `contact:${phoneKey}`,
            user_id: userId,
            phone: String(phone),
            name,
            first_name: name,
            last_name: "",
            profile_picture_url: contact.profile_picture_url || null,
            is_six7_user: Boolean(contact.is_six7_user || userId),
            is_classmate: false,
            is_contact_matched_classmate: false,
            grade: null,
            gender: null,
            visibility_boosts: Array.isArray(contact.visibility_boosts) ? contact.visibility_boosts : [],
            mutual_strength: Math.max(0, Number(contact.recommendation_strength || 0)),
            weekly_vote_count: Math.max(0, Number(contact.weekly_vote_count || 0)),
        };
        pool.push(choice);
        if (userId) {
            seenUserIds.add(userId);
            indexByUserId.set(userId, pool.length - 1);
        }
        if (!userId && nameKey) contactNameKeys.set(nameKey, pool.length - 1);
    }

    for (const classmate of classmates || []) {
        const userId = classmate?.user_id ? String(classmate.user_id) : null;
        if (!userId || userId === self) continue;
        const name = profileName(classmate);
        const classmateFields = {
            id: userId,
            user_id: userId,
            name,
            first_name: classmate.first_name || "",
            last_name: classmate.last_name || "",
            username: classmate.username,
            profile_picture_url: classmate.profile_picture_url || null,
            profile_picture_url_thumb: classmate.profile_picture_url_thumb || null,
            is_six7_user: true,
            is_classmate: true,
            grade: classmate.grade || null,
            gender: classmate.gender || null,
            weekly_vote_count: Math.max(0, Number(classmate.weekly_vote_count || 0)),
        };
        if (indexByUserId.has(userId)) {
            const index = indexByUserId.get(userId);
            const existing = pool[index];
            const boosts = Array.isArray(classmate.visibility_boosts) && classmate.visibility_boosts.length ? classmate.visibility_boosts : existing.visibility_boosts;
            pool[index] = { ...existing, ...classmateFields, phone: existing.phone, visibility_boosts: boosts, is_contact_matched_classmate: true };
            continue;
        }
        if (seenUserIds.has(userId)) continue;
        pool.push({
            ...classmateFields,
            phone: "",
            visibility_boosts: Array.isArray(classmate.visibility_boosts) ? classmate.visibility_boosts : [],
            is_contact_matched_classmate: false,
            mutual_strength: 0,
        });
        seenUserIds.add(userId);
        indexByUserId.set(userId, pool.length - 1);
    }

    return pool.filter((choice) => !choice.user_id || !blocked.has(choice.user_id));
}

/** The Play gate: four people in the pool, counted before any question is requested. */
export function canStartPlay(pool) {
    return (pool?.length || 0) >= PLAY_CHOICE_COUNT;
}

// MARK: - Picking four (selectWeightedRandomChoices)

function genderOf(value) {
    const gender = String(value ?? "").toLowerCase();
    if (!gender) return "unknown";
    if (gender.includes("male") && !gender.includes("fe")) return "male";
    if (gender.includes("female") || gender.includes("girl")) return "female";
    if (gender.includes("non") || gender.includes("trans") || gender.includes("nb")) return "other";
    return "unknown";
}

function gradeIndex(value) {
    const grade = String(value ?? "").toLowerCase();
    if (!grade) return null;
    if (grade.includes("6th")) return -3;
    if (grade.includes("7th")) return -2;
    if (grade.includes("8th")) return -1;
    if (grade.includes("freshman")) return 0;
    if (grade.includes("sophomore")) return 1;
    if (grade.includes("junior")) return 2;
    if (grade.includes("senior")) return 3;
    return null;
}

function tuningValue(tuning, key) {
    const value = tuning?.[key];
    return value === undefined || value === null ? DEFAULT_PLAY_TUNING[key] : value;
}

function baseWeight(choice, viewer, tuning, friendMultiplier) {
    if (!choice.is_classmate) {
        const contactWeight = Math.max(Number(tuningValue(tuning, "contact_weight")), 0);
        if (choice.mutual_strength > 0) {
            const mutual = Math.min(1 + choice.mutual_strength * Number(tuningValue(tuning, "mutual_strength_multiplier")), Number(tuningValue(tuning, "mutual_strength_cap")));
            return Math.ceil(contactWeight * mutual);
        }
        return contactWeight;
    }
    let weight = Math.max(Number(tuningValue(tuning, "classmate_weight")), 0);
    if (choice.is_contact_matched_classmate && friendMultiplier > 1) weight = Math.trunc(weight * friendMultiplier);
    const viewerGrade = gradeIndex(viewer?.grade);
    const choiceGrade = gradeIndex(choice.grade);
    if (viewerGrade === null || choiceGrade === null) return weight;
    const difference = Math.abs(viewerGrade - choiceGrade);
    const gradeWeight = difference === 0
        ? Math.max(Number(tuningValue(tuning, "same_grade_weight")), 0)
        : difference === 1 ? Math.max(Number(tuningValue(tuning, "one_grade_gap_weight")), 0) : Math.max(Number(tuningValue(tuning, "distant_grade_weight")), 0);
    return Math.trunc(weight * (1 + gradeWeight * 0.15));
}

function genderMultiplier(choice, viewer, tuning) {
    if (!tuningValue(tuning, "enable_cross_gender_bias")) return 1;
    const voter = genderOf(viewer?.gender);
    const option = genderOf(choice.gender);
    if (voter === option || voter === "unknown" || option === "unknown" || voter === "other" || option === "other") return 1;
    return Math.max(Number(tuningValue(tuning, "cross_gender_multiplier")), 0);
}

function boostMultiplier(choice, viewerUserId, totalClassmates, tuning) {
    if (!viewerUserId) return 1;
    const active = (choice.visibility_boosts || []).filter((boost) => Number(boost?.remaining_uses || 0) > 0
        && (boost.boost_type === "global" || (boost.boost_type === "targeted" && String(boost.target_user_id) === String(viewerUserId))));
    if (!active.length) return 1;
    const top = active.find((boost) => boost.boost_type === "targeted") || active[0];
    const multiplier = top.boost_type === "targeted"
        ? Number(tuningValue(tuning, "targeted_boost_multiplier_base")) + Number(tuningValue(tuning, "targeted_boost_multiplier_growth")) * totalClassmates
        : Number(tuningValue(tuning, "global_boost_multiplier_base")) + Number(tuningValue(tuning, "global_boost_multiplier_growth")) * totalClassmates;
    return Math.max(Math.ceil(multiplier), 1);
}

function randomInt(random, maxInclusive) {
    return 1 + Math.floor(random() * maxInclusive);
}

/**
 * Four choices for one question. `history` is the recent-choice cooldown list
 * (ids), updated in place like recordRecentChoiceHistory.
 */
export function selectPlayChoices(pool, { viewer = null, viewerUserId = null, tuning = null, history = [], random = Math.random, count = PLAY_CHOICE_COUNT } = {}) {
    const self = viewerUserId ? String(viewerUserId) : "";
    const choices = (pool || []).filter((choice) => !self || choice.user_id !== self);
    if (!choices.length || count <= 0) return [];
    const historyLimit = Math.max(Number(tuningValue(tuning, "recent_history_limit")) || 0, 0);
    const cooldownEnabled = Boolean(tuningValue(tuning, "enable_recent_choice_cooldown")) && historyLimit > 0;
    const record = (picked) => {
        if (!cooldownEnabled) return picked;
        for (const choice of picked) {
            const existing = history.indexOf(choice.id);
            if (existing >= 0) history.splice(existing, 1);
            history.push(choice.id);
        }
        if (history.length > historyLimit) history.splice(0, history.length - historyLimit);
        return picked;
    };

    const pityChance = Math.max(0, Math.min(1, Number(tuningValue(tuning, "pity_screen_chance")) || 0));
    if (random() <= pityChance && pityChance > 0) {
        const lowest = [];
        const keys = new Set();
        const users = choices.filter((choice) => choice.is_six7_user).sort((first, second) => first.weekly_vote_count - second.weekly_vote_count);
        for (const choice of users) {
            if (lowest.length >= count) break;
            const key = cardNameKey(choice.name);
            if (key && keys.has(key)) continue;
            if (key) keys.add(key);
            lowest.push(choice);
        }
        if (lowest.length >= count) return record(lowest);
    }

    let candidates = choices;
    if (cooldownEnabled) {
        const cooling = new Set(history);
        candidates = choices.filter((choice) => !cooling.has(choice.id));
        if (candidates.length < count) candidates = choices;
    }

    const genderChance = tuningValue(tuning, "enable_single_gender_polls") ? Math.max(0, Math.min(1, Number(tuningValue(tuning, "single_gender_poll_chance")) || 0)) : 0;
    if (genderChance > 0 && random() <= genderChance) {
        const boys = candidates.filter((choice) => genderOf(choice.gender) === "male");
        const girls = candidates.filter((choice) => genderOf(choice.gender) === "female");
        const eligible = [boys, girls].filter((group) => group.length >= count);
        if (eligible.length) candidates = eligible[Math.floor(random() * eligible.length)];
    }
    if (candidates.length < count) candidates = choices;

    const totalClassmates = choices.filter((choice) => choice.is_classmate).length;
    const friendMultiplier = Math.max(Number(tuningValue(tuning, "friend_multiplier_base")) + Number(tuningValue(tuning, "friend_multiplier_growth")) * totalClassmates, 1);
    const weighted = candidates.map((choice) => {
        const adjusted = Math.max(Math.ceil(baseWeight(choice, viewer, tuning, friendMultiplier) * genderMultiplier(choice, viewer, tuning)), 1);
        return { choice, weight: Math.max(adjusted * boostMultiplier(choice, self, totalClassmates, tuning), 1) };
    });

    const result = [];
    const used = new Set();
    const nameKeys = new Set();
    while (result.length < count && used.size < weighted.length) {
        let total = 0;
        const prefix = [];
        weighted.forEach((item, index) => {
            if (used.has(index)) return;
            total += item.weight;
            prefix.push([index, total]);
        });
        if (total <= 0) break;
        const target = randomInt(random, total);
        const [index] = prefix.find(([, cumulative]) => cumulative >= target);
        used.add(index);
        const choice = weighted[index].choice;
        const key = cardNameKey(choice.name);
        if (key && nameKeys.has(key)) continue;
        if (key) nameKeys.add(key);
        result.push(choice);
    }
    if (result.length < count) {
        const spillover = choices.filter((choice) => !result.includes(choice));
        for (const choice of spillover) {
            if (result.length >= count) break;
            const key = cardNameKey(choice.name);
            if (key && nameKeys.has(key)) continue;
            if (key) nameKeys.add(key);
            result.push(choice);
        }
        for (const choice of spillover) {
            if (result.length >= count) break;
            if (!result.includes(choice)) result.push(choice);
        }
    }
    return record(result);
}

// MARK: - Vote payload (PlayViewModel+Answering.swift)

/**
 * Counts people, not numbers, after a sync. `accepted` is the POST response
 * (normalized 10 digits + hash per stored row); `serverContacts` is GET
 * /contacts afterwards, whose phone_number is the hash and is_six7_user the match.
 */
export function summarizeContactSync({ owners, accepted = [], failedPhones = [], serverContacts = null, filteredNames = 0, unusableNumbers = 0 }) {
    const ownerOf = (phone) => owners.get(formatContactPhone(phone));
    const syncedPeople = new Set();
    const hashOwners = new Map();
    for (const row of accepted) {
        if (!row?.hashed_phone_number) continue;
        const owner = ownerOf(row.phone_number);
        if (owner === undefined) continue;
        syncedPeople.add(owner);
        hashOwners.set(String(row.hashed_phone_number).toLowerCase(), owner);
    }
    const failedPeople = new Set(failedPhones.map(ownerOf).filter((owner) => owner !== undefined && !syncedPeople.has(owner)));
    const attempted = new Set(owners.values());
    let onValid = null;
    if (Array.isArray(serverContacts)) {
        const matched = new Set();
        for (const contact of serverContacts) {
            const owner = hashOwners.get(String(contact?.phone_number || "").toLowerCase());
            if (owner !== undefined && contact.is_six7_user) matched.add(owner);
        }
        onValid = matched.size;
    }
    return {
        synced: syncedPeople.size,
        onValid,
        failed: failedPeople.size,
        skipped: filteredNames + unusableNumbers + Math.max(0, attempted.size - syncedPeople.size - failedPeople.size),
        syncedHashes: new Set(hashOwners.keys()),
    };
}

export function presentedOption(choice) {
    return { phone: choice?.phone || "", name: choice?.name || "" };
}

/**
 * POST /users/{id}/question-answers body. A non-user contact is identified by
 * its server phone hash and has no user id; a classmate by user id (plus the
 * contact's hash when they are also a contact).
 */
export function answerPayload({ questionId, selected, choices, isNomination = false, clientRequestId = undefined }) {
    const payload = {
        question_id: questionId,
        selected_contact_name: selected.name,
        presented_options: choices.map(presentedOption),
        is_nomination: Boolean(isNomination),
    };
    if (selected.phone) payload.selected_contact_phone = selected.phone;
    if (selected.user_id) payload.selected_contact_user_id = selected.user_id;
    if (clientRequestId) payload.client_request_id = clientRequestId;
    return payload;
}
