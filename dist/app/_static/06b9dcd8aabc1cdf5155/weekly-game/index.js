const cssURL=new URL('./styles.css',import.meta.url).href;

export function createWeeklyGame(options){
    let player,generation=0,abort;
    return {
        async open(){
            const current=++generation;player?.close();abort?.abort();abort=new AbortController();
            if(!document.querySelector('link[data-weekly-game-css]')){const link=document.createElement('link');link.rel='stylesheet';link.href=cssURL;link.dataset.weeklyGameCss='';document.head.append(link);}
            const featured=await options.api.getWeeklyGame({signal:abort.signal});if(current!==generation)return;
            if(featured.release?.runtime==='web-v1'){const {createWebGame}=await import('./web-game.js');if(current!==generation)return;player=createWebGame(options);}
            else {const {createCameraWeeklyGame}=await import('./camera.js');if(current!==generation)return;player=createCameraWeeklyGame(options);}
            await player.open(featured);
        },
        close(){generation++;abort?.abort();player?.close();player=null;},
    };
}
