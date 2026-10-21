// People you can start a chat with: classmates plus registered contacts beyond
// school (ChatCreationModel.merge), and their row subtitle
// (ChatPersonCandidate.subtitle). Shared by New Chat and Send To.
import { displayMember, SAY_HI_WAVE } from "./models.js";

export function mergeChatPeople(classmates, contacts, viewerId, friends = []) {
    const viewer = String(viewerId);
    const contactById = new Map();
    for (const contact of contacts) {
        if (!contact?.user_id || contact.is_six7_user === false || String(contact.user_id) === viewer) continue;
        const prior = contactById.get(String(contact.user_id));
        if (!prior || Number(contact.recommendation_strength || 0) > Number(prior.recommendation_strength || 0)) contactById.set(String(contact.user_id), contact);
    }
    const seen = new Set([viewer]);
    const people = [];
    for (const classmate of classmates) {
        const id = String(classmate.user_id || classmate.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const contact = contactById.get(id);
        contactById.delete(id);
        people.push({ id, name: displayMember(classmate), first: classmate.first_name || displayMember(classmate).split(/\s+/)[0], username: classmate.username || null, grade: classmate.grade || null, school: classmate.school_name || null, avatar: classmate.profile_picture_url, school_mate: true, contact: Boolean(contact), mutual: contact ? Math.max(0, Number(contact.recommendation_strength || 0) - 1) : 0 });
    }
    for (const [id, contact] of contactById) {
        if (seen.has(id)) continue;
        seen.add(id);
        const name = String(contact.name || '').trim() || 'Valid User';
        people.push({ id, name, first: name.split(/\s+/)[0], username: null, grade: null, school: contact.school_name || null, avatar: contact.profile_picture_url, school_mate: false, contact: true, mutual: Math.max(0, Number(contact.recommendation_strength || 0) - 1) });
    }
    const friendIds = new Set(friends.map((friend) => String(friend.user_id)));
    for (const person of people) if (friendIds.has(person.id)) person.friend = true;
    for (const friend of friends) {
        const id = String(friend.user_id);
        if (seen.has(id)) continue;
        seen.add(id);
        const name = displayMember(friend);
        people.push({ id, name, first: friend.first_name || name.split(/\s+/)[0], username: friend.username || null, grade: friend.grade || null, school: friend.school_name || null, avatar: friend.profile_picture_url, school_mate: false, contact: false, friend: true, mutual: 0 });
    }
    return people;
}

export function chatPersonSubtitle(person, hasChat) {
    if (person.friend) return "Friend on Valid";
    const known = person.contact ? "In your contacts" : person.username ? `@${person.username}` : person.grade || "On Valid";
    if (!hasChat && person.contact) return `${known} · Say hi ${SAY_HI_WAVE}`;
    if (person.school_mate) return `${known} · Your school`;
    if (person.mutual > 0) return `${known} · ${person.mutual} mutual`;
    if (person.school) return `${known} · ${person.school}`;
    return known;
}
