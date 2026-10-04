// Public story content follows native TBH sharing. Received TBHs omit the
// author's name; school/sent cards never disclose the anonymous author.
export function tbhShareContent(kind, item, prompt, authorDescriptor) {
    const received = kind === 'received';
    const descriptor = (authorDescriptor || 'from a classmate').replace(/^from /, '');
    return {
        headline: received ? `${descriptor.charAt(0).toUpperCase()}${descriptor.slice(1)} sent me a TBH`
            : kind === 'sent' ? `I sent ${item.subject_first_name} a TBH` : `${item.subject_first_name} got a TBH`,
        prompt, body: item.body,
        name: received ? '' : item.subject_first_name,
        descriptor: received ? '' : authorDescriptor,
        photo: received ? item.author_profile_picture_url : item.subject_profile_picture_url,
        supporting: !received,
    };
}

export async function createTbhShareFile(content, { loadArtwork, assetURL }) {
    await document.fonts?.ready;
    const canvas = document.createElement('canvas');
    canvas.width = 900; canvas.height = 1600;
    const ctx = canvas.getContext('2d');
    const round = (x,y,w,h,r,fill,stroke='#000',line=5) => {
        ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();
        if(stroke) {ctx.strokeStyle=stroke;ctx.lineWidth=line;ctx.stroke();}
    };
    const lines = (text, width, size) => {
        ctx.font = `${size}px "Jua", "Apple Color Emoji", sans-serif`;
        const result=[];
        for (const paragraph of String(text || '').split('\n')) {
            let line='';
            for(const word of paragraph.split(/\s+/)) {
                if(ctx.measureText((line ? line+' ' : '')+word).width>width && line) {result.push(line);line='';}
                for(const char of (line?' ':'')+word) {
                    if(ctx.measureText(line+char).width>width && line) {result.push(line);line='';}
                    line+=char;
                }
            }
            result.push(line);
        }
        return result;
    };
    const text = (value, y, size, width, color='#000', maxHeight=Infinity, centerX=450) => {
        let rows=lines(value,width,size);
        while(rows.length*size*1.2>maxHeight && size>18) rows=lines(value,width,--size);
        ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='top';
        rows.forEach((line,i)=>ctx.fillText(line,centerX,y+i*size*1.2));
        return rows.length*size*1.2;
    };
    ctx.fillStyle='#ccf7f4';ctx.fillRect(0,0,900,1600);
    for(const [x,y,r,color] of [[840,0,270,'#ffb8d6'],[0,1500,250,'#ffb15e']]) {
        ctx.globalAlpha=.6;ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    }
    if(content.supporting) {round(387,65,126,58,29,'#ffb8d6');text('TBH',76,34,120);}
    const avatarY=content.supporting?168:92;
    ctx.save();ctx.beginPath();ctx.arc(450,avatarY+83,83,0,Math.PI*2);ctx.clip();
    ctx.fillStyle='#ffb15e';ctx.fillRect(367,avatarY,166,166);
    const image=content.photo ? await loadArtwork(assetURL(content.photo)).catch(()=>null) : null;
    if(image) {const size=Math.min(image.width,image.height);ctx.drawImage(image,(image.width-size)/2,(image.height-size)/2,size,size,367,avatarY,166,166);}
    else text('?',avatarY+38,78,150);
    ctx.restore();ctx.beginPath();ctx.arc(450,avatarY+83,83,0,Math.PI*2);ctx.strokeStyle='#000';ctx.lineWidth=7;ctx.stroke();
    let y=avatarY+195;
    if(content.name) y+=text(content.name,y,30,720)+14;
    y+=text(content.headline,y,48,780,'#000',135)+20;
    y+=text(content.prompt,y,28,770,'#37676b',80)+20;
    if(content.descriptor) y+=text(content.descriptor,y,28,770,'#000',80)+25;
    const cardY=Math.max(content.supporting?660:525,y+28), cardH=content.supporting?500:580;
    round(80,cardY+18,772,cardH,54,'#000',null);
    round(64,cardY,772,cardH,54,'#fff','#000',8);
    round(94,cardY-26,235,52,26,'#ffb15e');text('TO BE HONEST',cardY-15,24,230,'#000',Infinity,211.5);
    text(content.body,cardY+60,content.body.length>220?43:54,664,'#000',cardH-115);
    text('validapp.lol',1470,38,800);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob) throw new Error('Could not create the TBH image.');
    return new File([blob],'valid-tbh.png',{type:'image/png'});
}
