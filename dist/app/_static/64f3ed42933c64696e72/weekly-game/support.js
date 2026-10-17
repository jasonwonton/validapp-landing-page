// Complete detector + recording rounds are validated on Chromium. WebKit's
// worker initialization stalled and Firefox's continuous camera round did not
// start reliably. Reject those browsers before requesting camera access.
export function cameraGameSupport() {
    const ua=navigator.userAgent;
    const ios=/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints>1);
    if(ios)return {supported:false,ios:true,message:'Play camera challenges in the Valid iOS app. You can still view the leaderboard here.'};
    if(!/Chrome\/|Chromium\/|Edg\//.test(ua))return {supported:false,message:'To play camera challenges on the web, open Valid in Chrome. You can still view the leaderboard here.'};
    if(!navigator.mediaDevices?.getUserMedia || !window.Worker || !window.createImageBitmap || !window.OffscreenCanvas)return {supported:false,message:'Update your browser to play camera challenges.'};
    return {supported:true};
}
