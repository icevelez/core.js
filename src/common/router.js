import { Derived, State } from "../../core/reactivity.js";

class RouterInstance {

    #url = new State(new URL(window.location));

    /**
     * Used to cache RegEx and ParamNames of a Route to skip doing ".replace" and ".push" inside `matchRoute()`
     * @type {Map<string, { regex : RegExp, paramNames : string[] }>}
     */
    #cachePatterns = new Map();

    #updateHashFragment = () => {
        let route = window.location.hash.replace("#", "");
        if (route.substring(0, 1) !== "/") route = `/${route}`;
        this.#url.value = new URL(`${window.location.protocol}//${window.location.host}${route}`);
    }

    queryParams = new Derived(() => this.#url.value.searchParams);
    pathname = new Derived(() => this.#url.value.pathname);

    constructor() {
        this.#updateHashFragment();
        window.addEventListener('hashchange', this.#updateHashFragment);

        this.queryParams.get = (key) => {
            return this.queryParams.value[key];
        }

        this.queryParams.set = (key, value) => {
            this.queryParams.value[key] = value;
        }

        this.queryParams.toString = () => {
            return Object.entries(this.queryParams.value).map(([k, v]) => `${k}=${v}`).join("&");
        }
    }

    /**
     * @param {string} route_pattern
     */
    matchRoute = (route_pattern) => {
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

        const match = this.pathname.value.match(route.regex);

        /**
         * @type {{ match : boolean, params : Record<string, string> }}
         */
        const result = { match: false, params: {} };
        if (!match) return result;

        for (let i = 0; i < route.paramNames.length; i++) {
            const key = route.paramNames[i];
            result.params[key] = match[i];
        }

        result.match = true;
        return result;
    }
}

export const Router = new RouterInstance();
