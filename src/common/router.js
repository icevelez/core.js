import { createSignal } from "../../core/reactivity.js";

class RouterInstance {

    #url = createSignal(new URL(window.location));

    /**
     * Used to cache RegEx and ParamNames of a Route to skip doing ".replace" and ".push" inside `matchRoute()`
     * @type {Map<string, { regex : RegExp, paramNames : string[] }>}
     */
    #cachePatterns = new Map();

    #updateHashFragment = () => {
        let route = window.location.hash.replace("#", "");
        if (route.substring(0, 1) !== "/") route = `/${route}`;
        this.#url.set(new URL(`${window.location.protocol}//${window.location.host}${route}`));
    }

    get queryParams() {
        return this.#url().searchParams;
    };

    get pathname() {
        return this.#url().pathname;
    }

    constructor() {
        this.#updateHashFragment();
        window.addEventListener('hashchange', this.#updateHashFragment);
    }

    /**
     * @param {string} route_pattern
     */
    match = (route_pattern) => {
        let route = { regex: new RegExp(""), paramNames: [] };

        if (this.#cachePatterns.has(route_pattern)) {
            route = this.#cachePatterns.get(route_pattern);
        } else {
            route.regex = new RegExp(`${route_pattern
                .replace(/:([^\/]+)/g, (_, key) => {
                    route.paramNames.push(key);
                    return "([^\\/]+)";
                })
                .replace(/\*$/, () => {
                    route.paramNames.push("wildcard");
                    return "(.*)";
                })}$`)
            this.#cachePatterns.set(route_pattern, route);
        }

        const match = this.pathname.match(route.regex);

        /**
         * @type {{ is_match : boolean, params : Record<string, string> }}
         */
        const result = { is_match: false, params: {} };
        if (!match) return result;

        for (let i = 0; i < route.paramNames.length; i++) {
            const key = route.paramNames[i];
            result.params[key] = match[i];
        }

        result.is_match = true;
        return result;
    }
}

export const Router = new RouterInstance();
