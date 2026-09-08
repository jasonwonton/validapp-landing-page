// Keep these product labels in step with FeedItemRow.swift / TbhResponseViews.swift.
// Use only demographics and reveal hints supplied by the authoritative API.
export function senderGrade(value) {
    const grade = String(value || '').split(' (')[0].trim();
    const lower = grade.toLowerCase();
    for (const [number, ordinal, label] of [[6, '6th', '6th grader'], [7, '7th', '7th grader'], [8, '8th', '8th grader'], [9, '9th', 'Freshman'], [10, '10th', 'Sophomore'], [11, '11th', 'Junior'], [12, '12th', 'Senior']]) {
        if (lower === String(number) || lower.includes(ordinal) || lower.startsWith(`grade ${number}`) || lower.includes(label.toLowerCase())) return label;
    }
    return grade;
}

export function senderEmoji(value) {
    const gender = String(value || '').trim().toLowerCase();
    if (['male', 'boy'].includes(gender)) return '👦💙';
    if (['female', 'girl'].includes(gender)) return '👧💗';
    if (['non-binary', 'nonbinary'].includes(gender)) return '🧑💛';
    return '';
}

const article = grade => /^(?:[aeiou8]|11|18)/i.test(grade) ? 'an' : 'a';

export function senderGradeIsSafe(value, classmates = []) {
    const grade = senderGrade(value).toLowerCase();
    if (!grade) return false;
    const ids = new Set(classmates.filter(person => senderGrade(person.grade).toLowerCase() === grade)
        .map(person => person.user_id || person.id).filter(Boolean));
    return ids.size >= 2;
}

export function feedVoterLine(item, { personal = false, currentName = '', subscriber = false, safeGrade = false } = {}) {
    if (item.current_user_voted) return currentName ? `from ${currentName}${personal ? '' : ' (you 🫵)'}` : 'from you';
    if (item.voter_name) return `${personal ? 'by' : 'from'} ${item.voter_name}`;
    const emoji = senderEmoji(item.voter_gender);
    if (!emoji) return '';
    const grade = senderGrade(item.voter_grade);
    const subscriberHint = personal && subscriber && !!grade;
    if (grade && (safeGrade || subscriberHint)) {
        const letter = subscriberHint ? Array.from(String(item.voter_first_letter_hint || '').trim())[0]?.toLocaleUpperCase() : '';
        return `from ${article(grade)} ${emoji} ${grade}${letter ? ` (${letter})` : ''}`;
    }
    return `from a ${emoji} (grade hidden until more classmates join)`;
}

export function tbhSenderLine(item, { safeGrade = false } = {}) {
    const emoji = senderEmoji(item.author_gender);
    if (!emoji) return 'from a classmate';
    const grade = senderGrade(item.author_grade);
    if (!grade) return `from a classmate ${emoji}`;
    if (!safeGrade) return `from a classmate ${emoji} (grade hidden until more classmates join)`;
    return `from ${article(grade)} ${grade} ${emoji}`;
}
