// Story-sized share images for polls, Ask Me replies and Ask Me links. Loaded
// on demand the first time someone shares, so it stays out of the startup shell.
let api = null;
let state = null;
let displayName = (profile) => profile?.first_name || "";
let formatVoterDemographicsStatement = () => "Poll";

export function configureShareCards(context) {
    ({ api, state, displayName, formatVoterDemographicsStatement } = context);
}

function canvasRoundedRect(context, x, y, width, height, radius) {
    const corner = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + corner, y);
    context.arcTo(x + width, y, x + width, y + height, corner);
    context.arcTo(x + width, y + height, x, y + height, corner);
    context.arcTo(x, y + height, x, y, corner);
    context.arcTo(x, y, x + width, y, corner);
    context.closePath();
}

function canvasTextLines(context, text, maxWidth, maxLines = Infinity) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let current = words.shift();
    for (const word of words) {
        const candidate = `${current} ${word}`;
        if (context.measureText(candidate).width <= maxWidth || !current) current = candidate;
        else {
            lines.push(current);
            current = word;
        }
    }
    lines.push(current);
    if (lines.length <= maxLines) return lines;
    const visible = lines.slice(0, maxLines);
    let last = visible[maxLines - 1];
    while (last && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    visible[maxLines - 1] = `${last}…`;
    return visible;
}

function drawCenteredCanvasText(context, text, centerX, top, maxWidth, lineHeight, maxLines = Infinity) {
    const lines = canvasTextLines(context, text, maxWidth, maxLines);
    context.textAlign = "center";
    context.textBaseline = "top";
    lines.forEach((line, index) => context.fillText(line, centerX, top + index * lineHeight));
    return top + lines.length * lineHeight;
}

export async function loadShareArtwork(url) {
    if (!url) return Promise.resolve(null);
    try {
        const response = await fetch(url, { credentials: "omit", mode: "cors" });
        if (response.ok) {
            const objectURL = URL.createObjectURL(await response.blob());
            const image = await new Promise((resolve) => {
                const candidate = new Image();
                candidate.onload = () => resolve(candidate);
                candidate.onerror = () => resolve(null);
                candidate.src = objectURL;
            });
            URL.revokeObjectURL(objectURL);
            if (image) return image;
        }
    } catch (_) {
        // The direct image path below still works for same-origin and CORS-enabled assets.
    }
    return new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = url;
    });
}

function pollShareArtworkFallback(url) {
    // Use the existing public-image API, never a general-purpose URL proxy.
    const source = new URL(url, location.href);
    if (source.protocol !== "https:" || source.username || source.password || source.port
        || !["validappcdn.com", "media.six7.lol", "staging.validappcdn.com"].includes(source.hostname)) return null;
    let key;
    try { key = decodeURIComponent(source.pathname.slice(1)); } catch (_) { return null; }
    if (!/^(questions\/images|question-images)\//.test(key) || key.length > 512
        || key.includes("\\") || key.split("/").some(part => !part || part === "." || part === "..")) return null;
    const base = api.baseURL || new URL("/api/v1", location.origin).href;
    return `${base.replace(/\/$/, "")}/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function loadPollShareArtwork(item) {
    const displayedArtwork = document.querySelector("#feedDetailBody .feed-detail-art > img")?.currentSrc;
    const candidates = [api.assetURL(item.image_url), displayedArtwork]
        .filter((url, index, urls) => url && urls.indexOf(url) === index);
    for (const url of candidates) {
        const artwork = await loadShareArtwork(url);
        if (artwork) return artwork;
        // Public CDN images can display as images without CORS but cannot be
        // copied into a canvas. The API returns the same bytes with valid CORS.
        const fallback = pollShareArtworkFallback(url);
        if (fallback) {
            const recovered = await loadShareArtwork(fallback);
            if (recovered) return recovered;
        }
    }
    if (candidates.length) throw new Error("Poll artwork is unavailable. Please try again.");
    return null;
}

function canvasBlob(canvas, type = "image/png", quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not render image.")), type, quality);
    });
}

function pollShareNominationSubtitle(item) {
    const voter = formatVoterDemographicsStatement(item);
    if (voter === "Poll") return "got nominated";
    const demographic = voter.replace(/ said$/, "").replace(/^(A|An)\s/, (article) => article.toLowerCase());
    return `got nominated by ${demographic}`;
}

export async function createPollShareFile(item) {
    await document.fonts?.ready;
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 1600;
    const context = canvas.getContext("2d");
    const centerX = canvas.width / 2;
    const selectedName = item.selected_contact_name
        || item.voted_for_name
        || item.contact_name
        || (item.item_type === "received_vote" ? displayName(state.profile) : "Someone");
    const isNomination = item.is_nomination === true;
    const options = !isNomination && Array.isArray(item.presented_options) ? item.presented_options.slice(0, 4) : [];
    const artwork = await loadPollShareArtwork(item);

    context.fillStyle = "#ccf7f4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000000";
    // iOS keeps the shared image anonymous even after a sender is revealed.
    const voterStatement = formatVoterDemographicsStatement(item);
    const showsVoterStatement = voterStatement && voterStatement !== "Poll";
    const gridRows = options.length ? Math.ceil(options.length / 2) : 0;
    const gridHeight = isNomination ? 400 : options.length ? gridRows * 200 + Math.max(0, gridRows - 1) * 20 : 0;
    const brandingHeight = 62;
    const brandingGap = 63;
    const contentTop = artwork ? 60 : 260;

    context.font = '44px "Jua", "Apple Color Emoji", sans-serif';
    let contentBottom = showsVoterStatement
        ? drawCenteredCanvasText(context, voterStatement, centerX, contentTop, 820, 52, 2)
        : 0;
    context.font = '56px "Jua", "Apple Color Emoji", sans-serif';
    const questionTop = showsVoterStatement ? contentBottom + 40 : contentTop;
    contentBottom = drawCenteredCanvasText(context, item.question_text, centerX, questionTop, 820, 63, 3);

    if (artwork) {
        const y = contentBottom + 40;
        const availableHeight = Math.max(260, canvas.height - y - 24 - gridHeight - brandingGap - brandingHeight);
        const scale = Math.min(780 / artwork.naturalWidth, Math.min(780, availableHeight) / artwork.naturalHeight);
        const width = artwork.naturalWidth * scale;
        const height = artwork.naturalHeight * scale;
        const x = centerX - width / 2;
        canvasRoundedRect(context, x, y, width, height, 24);
        context.save();
        context.clip();
        context.drawImage(artwork, x, y, width, height);
        context.restore();
        context.strokeStyle = "#000000";
        context.lineWidth = 6;
        canvasRoundedRect(context, x, y, width, height, 24);
        context.stroke();
        contentBottom = y + height;
    }

    const gridTop = contentBottom + 24;
    let selectedPointer = null;
    if (isNomination) {
        const x = 40;
        const y = gridTop;
        const width = 820;
        const height = 400;
        context.fillStyle = "#ffb15e";
        canvasRoundedRect(context, x, y, width, height, 32);
        context.fill();
        context.strokeStyle = "#000000";
        context.lineWidth = 8;
        context.stroke();
        context.fillStyle = "#000000";
        context.font = '64px "Jua", "Apple Color Emoji", sans-serif';
        const nameLines = canvasTextLines(context, selectedName, width - 70, 2);
        const nameTop = y + 105 - (nameLines.length - 1) * 32;
        context.textAlign = "center";
        context.textBaseline = "top";
        nameLines.forEach((line, index) => context.fillText(line, centerX, nameTop + index * 72));
        context.font = '36px "Jua", "Apple Color Emoji", sans-serif';
        drawCenteredCanvasText(context, pollShareNominationSubtitle(item), centerX, y + 280, width - 70, 44, 2);
    } else if (options.length) {
        const gap = 20;
        const cardWidth = 400;
        const cardHeight = 200;
        options.forEach((option, index) => {
            const name = option.name || option.contact_name || "Someone";
            const selected = option.is_selected === true || name === selectedName;
            const column = index % 2;
            const row = Math.floor(index / 2);
            const x = 40 + column * (cardWidth + gap);
            const y = gridTop + row * (cardHeight + gap);
            context.fillStyle = "#ffb15e";
            canvasRoundedRect(context, x, y, cardWidth, cardHeight, 24);
            context.fill();
            context.strokeStyle = selected ? "#ffff00" : "#000000";
            context.lineWidth = 6;
            context.stroke();
            context.fillStyle = "#000000";
            context.font = '44px "Jua", "Apple Color Emoji", sans-serif';
            const lines = canvasTextLines(context, name, cardWidth - 40, 2);
            const nameTop = y + (cardHeight - lines.length * 52) / 2;
            context.textAlign = "center";
            context.textBaseline = "top";
            lines.forEach((line, lineIndex) => context.fillText(line, x + cardWidth / 2, nameTop + lineIndex * 52));
            if (selected) {
                selectedPointer = { x: x + cardWidth / 2, y: y + cardHeight + 29 };
            }
        });
        if (selectedPointer) {
            context.font = '60px "Apple Color Emoji", sans-serif';
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText("👆", selectedPointer.x, selectedPointer.y);
        }
    }

    context.fillStyle = "#000000";
    context.font = '52px "Jua", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText("validapp.lol", centerX, gridTop + gridHeight + brandingGap);
    const blob = await canvasBlob(canvas);
    const identifier = String(item.question_answer_id || item.question_id || "poll").replace(/[^a-z0-9_-]/gi, "");
    return new File([blob], `valid-poll-${identifier}.png`, { type: "image/png" });
}

function fitCanvasStoryText(context, text, maxWidth, maxHeight, preferredSize, minimumSize = 30, maxLines = 10) {
    const value = String(text || "").trim();
    for (let size = preferredSize; size >= minimumSize; size -= 2) {
        context.font = `${size}px "Jua", "Apple Color Emoji", sans-serif`;
        const lineHeight = Math.round(size * 1.16);
        const lines = canvasTextLines(context, value, maxWidth, maxLines + 1);
        if (lines.length <= maxLines && lines.length * lineHeight <= maxHeight) return { lines, lineHeight };
    }
    context.font = `${minimumSize}px "Jua", "Apple Color Emoji", sans-serif`;
    return {
        lines: canvasTextLines(context, value, maxWidth, maxLines),
        lineHeight: Math.round(minimumSize * 1.16),
    };
}

function drawAnonymousAnswerStoryCard(context, { badge, text, fill, y, height, preferredSize }) {
    const x = 64;
    const width = 772;
    context.fillStyle = "#000000";
    canvasRoundedRect(context, x + 14, y + 16, width, height, 48);
    context.fill();
    context.fillStyle = fill;
    canvasRoundedRect(context, x, y, width, height, 48);
    context.fill();
    context.strokeStyle = "#000000";
    context.lineWidth = 7;
    context.stroke();

    const fitted = fitCanvasStoryText(context, text, width - 108, height - 96, preferredSize);
    const textTop = y + (height - fitted.lines.length * fitted.lineHeight) / 2;
    context.fillStyle = "#000000";
    context.textAlign = "center";
    context.textBaseline = "top";
    fitted.lines.forEach((line, index) => {
        context.fillText(line, x + width / 2, textTop + index * fitted.lineHeight);
    });

    context.beginPath();
    context.arc(x + 12, y + 10, 32, 0, Math.PI * 2);
    context.fillStyle = "#000000";
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = '34px "Jua", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(badge, x + 12, y + 12);
}

export async function createAnonymousAnswerShareFile(question) {
    await document.fonts?.ready;
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 1600;
    const context = canvas.getContext("2d");
    const centerX = canvas.width / 2;

    context.fillStyle = "#ccf7f4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(255,184,214,.62)";
    context.beginPath();
    context.arc(830, -440, 260, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(255,177,94,.46)";
    context.beginPath();
    context.arc(-180, 1500, 240, 0, Math.PI * 2);
    context.fill();

    const askerLabel = question.provenance_label || "Anonymous";
    context.font = '30px "Jua", "Apple Color Emoji", sans-serif';
    const labelWidth = Math.min(760, Math.max(210, context.measureText(askerLabel).width + 56));
    context.fillStyle = "#ffb8d6";
    canvasRoundedRect(context, centerX - labelWidth / 2, 118, labelWidth, 60, 30);
    context.fill();
    context.strokeStyle = "#000000";
    context.lineWidth = 5;
    context.stroke();
    context.fillStyle = "#000000";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(askerLabel, centerX, 149);

    drawAnonymousAnswerStoryCard(context, {
        badge: "M",
        text: question.body,
        fill: "#ffffff",
        y: 220,
        height: 390,
        preferredSize: String(question.body || "").length > 130 ? 45 : 54,
    });

    context.strokeStyle = "#ffb15e";
    context.fillStyle = "#ffb15e";
    context.lineWidth = 18;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(centerX, 642);
    context.lineTo(centerX, 692);
    context.stroke();
    context.beginPath();
    context.moveTo(centerX - 22, 676);
    context.lineTo(centerX, 702);
    context.lineTo(centerX + 22, 676);
    context.closePath();
    context.fill();

    drawAnonymousAnswerStoryCard(context, {
        badge: "R",
        text: question.answer_text,
        fill: "#ffb15e",
        y: 730,
        height: 500,
        preferredSize: String(question.answer_text || "").length > 260 ? 42 : 55,
    });

    const username = state.profile?.username || api.user?.username;
    if (username) {
        context.fillStyle = "#3d7777";
        context.font = '34px "Jua", sans-serif';
        context.textAlign = "center";
        context.textBaseline = "top";
        context.fillText(`@${username}`, centerX, 1262);
    }

    const logo = await loadShareArtwork(new URL("/assets/valid_logo.png", import.meta.url).href);
    if (logo) {
        const logoWidth = 250;
        const logoHeight = Math.min(96, logoWidth * (logo.naturalHeight / logo.naturalWidth));
        context.drawImage(logo, centerX - logoWidth / 2, 1390, logoWidth, logoHeight);
    } else {
        context.fillStyle = "#000000";
        context.font = '58px "Jua", sans-serif';
        context.textAlign = "center";
        context.textBaseline = "top";
        context.fillText("Valid", centerX, 1390);
    }

    const blob = await canvasBlob(canvas);
    const identifier = String(question.id || "reply").replace(/[^a-z0-9_-]/gi, "");
    return new File([blob], `valid-reply-${identifier}.png`, { type: "image/png" });
}

function drawAskStoryBubble(context, x, y, width, height, color, rotation = 0) {
    context.save();
    context.translate(x + width / 2, y + height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.translate(-width / 2, -height / 2);
    context.fillStyle = "#000000";
    canvasRoundedRect(context, 14, 16, width, height, 54);
    context.fill();
    context.fillStyle = color;
    canvasRoundedRect(context, 0, 0, width, height, 54);
    context.fill();
    context.strokeStyle = "#000000";
    context.lineWidth = 8;
    context.stroke();
    context.fillStyle = "rgba(0,0,0,.72)";
    [width / 2 - 52, width / 2, width / 2 + 52].forEach((dotX) => {
        context.beginPath();
        context.arc(dotX, height / 2, 17, 0, Math.PI * 2);
        context.fill();
    });
    context.restore();
}

function drawAskStoryArrow(context, x, y, direction, color, rotation = 0) {
    context.save();
    context.translate(x, y);
    context.rotate(rotation * Math.PI / 180);
    context.strokeStyle = "rgba(0,0,0,.2)";
    context.fillStyle = "rgba(0,0,0,.2)";
    context.lineWidth = 17;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(5, direction === "down" ? 5 : 73);
    context.lineTo(5, direction === "down" ? 73 : 5);
    context.stroke();
    context.beginPath();
    if (direction === "down") {
        context.moveTo(-25, 51);
        context.lineTo(5, 86);
        context.lineTo(35, 51);
    } else {
        context.moveTo(-25, 27);
        context.lineTo(5, -8);
        context.lineTo(35, 27);
    }
    context.closePath();
    context.fill();
    context.translate(-4, -5);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(5, direction === "down" ? 5 : 73);
    context.lineTo(5, direction === "down" ? 73 : 5);
    context.stroke();
    context.beginPath();
    if (direction === "down") {
        context.moveTo(-25, 51);
        context.lineTo(5, 86);
        context.lineTo(35, 51);
    } else {
        context.moveTo(-25, 27);
        context.lineTo(5, -8);
        context.lineTo(35, 27);
    }
    context.closePath();
    context.fill();
    context.restore();
}

export async function createAskStoryFile(platform) {
    await document.fonts?.ready;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    const context = canvas.getContext("2d");
    const centerX = canvas.width / 2;
    const username = state.profile?.username || api.user?.username || "valid";

    context.fillStyle = "#ccf7f4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(255,184,214,.5)";
    context.beginPath();
    context.arc(970, -40, 310, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(255,177,94,.45)";
    context.beginPath();
    context.arc(-70, 1680, 260, 0, Math.PI * 2);
    context.fill();

    drawAskStoryBubble(context, 20, 255, 410, 175, "#ffb8d6", -10);
    drawAskStoryBubble(context, 700, 850, 360, 155, "#ffb15e", 9);

    context.fillStyle = "#000000";
    canvasRoundedRect(context, 137, 374, 850, 610, 76);
    context.fill();
    context.fillStyle = "#ffffff";
    canvasRoundedRect(context, 115, 350, 850, 610, 76);
    context.fill();
    context.strokeStyle = "#000000";
    context.lineWidth = 10;
    context.stroke();

    context.fillStyle = "#000000";
    context.font = '94px "Jua", "Apple Color Emoji", sans-serif';
    const titleBottom = drawCenteredCanvasText(context, "send me anonymous messages", centerX, 490, 735, 106, 3);
    context.fillStyle = "#3d7777";
    context.font = '46px "Jua", sans-serif';
    drawCenteredCanvasText(context, `@${username}`, centerX, titleBottom + 42, 710, 54, 1);

    const targetWidth = platform === "snapchat" ? 600 : 650;
    const targetHeight = platform === "snapchat" ? 132 : 126;
    const targetX = centerX - targetWidth / 2;
    const targetY = platform === "snapchat" ? 1280 : 1245;
    [centerX - 230, centerX, centerX + 230].forEach((x, index) => {
        drawAskStoryArrow(context, x, targetY - 120, "down", index === 1 ? "#ffb15e" : "#ffb8d6", (index - 1) * 12);
        drawAskStoryArrow(context, x, targetY + targetHeight + 46, "up", index === 1 ? "#ffb8d6" : "#ffb15e", (1 - index) * 12);
    });
    context.fillStyle = "#000000";
    canvasRoundedRect(context, targetX + 13, targetY + 15, targetWidth, targetHeight, targetHeight / 2);
    context.fill();
    canvasRoundedRect(context, targetX, targetY, targetWidth, targetHeight, targetHeight / 2);
    context.fill();
    context.strokeStyle = platform === "snapchat" ? "#ffb15e" : "#000000";
    context.lineWidth = 8;
    context.stroke();
    if (platform === "instagram") {
        context.fillStyle = "#ffffff";
        context.font = '35px "Jua", sans-serif';
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("ADD LINK STICKER HERE", centerX, targetY + targetHeight / 2 + 2);
    } else {
        context.fillStyle = "#ffb8d6";
        context.font = '35px "Jua", sans-serif';
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("ADD LINK STICKER HERE", centerX, targetY + targetHeight / 2 + 2);
    }

    const logo = await loadShareArtwork(new URL("/assets/valid_logo.png", import.meta.url).href);
    if (logo) {
        const logoWidth = 324;
        const logoHeight = logoWidth * (logo.naturalHeight / logo.naturalWidth);
        context.drawImage(logo, centerX - logoWidth / 2, 1550, logoWidth, logoHeight);
    } else {
        context.fillStyle = "#000000";
        context.font = '72px "Jua", sans-serif';
        context.textAlign = "center";
        context.textBaseline = "top";
        context.fillText("Valid", centerX, 1550);
    }

    const blob = await canvasBlob(canvas);
    return new File([blob], `valid-ask-${platform}.png`, { type: "image/png" });
}

