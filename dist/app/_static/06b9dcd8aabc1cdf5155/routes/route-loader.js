const routeImports = {
    feed: () => import("./feed.js"),
    play: () => import("./play.js"),
    chats: () => import("./chats.js"),
    profile: () => import("./profile.js"),
};

const routeModules = new Map();

export function preloadRoute(name) {
    if (!routeImports[name]) return Promise.resolve(null);
    if (!routeModules.has(name)) routeModules.set(name, routeImports[name]());
    return routeModules.get(name);
}

export async function activateRoute(name, context) {
    const route = await preloadRoute(name);
    if (!route || context.isCurrent?.() === false) return;
    return route.activate(context);
}
