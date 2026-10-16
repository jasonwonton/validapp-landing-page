const cssURL=new URL('./styles.css',import.meta.url).href;

// iOS EasterEggGameView: a game opens on its home (Best / Rank / Play /
// Friend Leaderboard); Play starts a round, and closing the round returns to
// the home. `launch` (the chat /play command) starts a round straight away,
// with the home underneath.
export function createWeeklyGame(options){
    let player,home,generation=0,abort;
    async function createPlayer(release){
        const {weeklyGameEntry}=await import('./compat.js');
        if(weeklyGameEntry(release)!=='play')return null;
        const playerOptions={...options,onClose:()=>{player=null;void home?.refresh();}};
        if(release?.runtime==='web-v1'){const {createWebGame}=await import('./web-game.js');return createWebGame(playerOptions);}
        const {createCameraWeeklyGame}=await import('./camera.js');return createCameraWeeklyGame(playerOptions);
    }
    return {
        async open({release:chosen=null,launch=false}={}){
            const current=++generation;player?.close();player=null;home?.close();home=null;abort?.abort();abort=new AbortController();
            if(!document.querySelector('link[data-weekly-game-css]')){const link=document.createElement('link');link.rel='stylesheet';link.href=cssURL;link.dataset.weeklyGameCss='';document.head.append(link);}
            const featured=chosen?{release:chosen}:await options.api.getWeeklyGame({signal:abort.signal});if(current!==generation)return;
            const [{weeklyGameEntry},{createGameHome}]=await Promise.all([import('./compat.js'),import('./home.js')]);if(current!==generation)return;
            const next=createGameHome({
                api:options.api,
                playable:release=>weeklyGameEntry(release)==='play',
                onPlay:async release=>{
                    player?.close();player=null;
                    const created=await createPlayer(release);if(current!==generation||!created)return;
                    player=created;await created.open({...featured,release});
                },
                onClose:()=>{if(home===next){player?.close();player=null;home=null;options.onClose?.();}},
            });
            home=next;await next.open(featured.release);if(current!==generation)return;
            if(launch)await next.play();
        },
        close(){generation++;abort?.abort();player?.close();player=null;home?.close();home=null;},
    };
}
