// Sharing a finished round (EasterEggScoreShareControls): Share on Snapchat
// and More… both hand the file to the system share sheet; a browser that
// can't share files saves it instead, and Snapchat then opens on phones.
const mobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function snapchatGlyph() {
    return '<img class="weekly-game-snapchat-glyph" src="../assets/app/snapchat-logo.webp" width="24" height="24" alt="" decoding="async">';
}

/** Resolves with a status line to show, or "" when nothing needs saying. */
export async function shareResultFile(file, { target = 'more', title = '', text = '' } = {}) {
    try {
        if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title, text });
            return '';
        }
    } catch (error) {
        if (error?.name === 'AbortError') return '';
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url; link.download = file.name; link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    const kind = file.type.startsWith('video/') ? 'video' : 'image';
    if (target === 'snapchat' && mobile()) {
        setTimeout(() => { location.href = 'snapchat://'; }, 400);
        return `Saved your ${kind}. Add it to a Snap from your camera roll.`;
    }
    return `Saved your ${kind}. Share it to Snapchat, Instagram, or TikTok from your photos or files.`;
}
