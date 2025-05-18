import { isObject, makeId } from "./helper-functions.js";

// =======================================================================

const is_debugger_on = true;

const __reactivity = {
    states: new Set(),
    proxies: new Set(),
}

if (is_debugger_on) window.__reactivity = __reactivity;

// =======================================================================

/**
* @type {Set<Function>}
*/
const subscriber_queue = new Set();

let is_notifying_subscribers = false;

/**
* @param {Set<Function>} subscribers
*/
function notifySubscribers(subscribers) {
    for (let subscriber of subscribers) subscriber_queue.add(subscriber);

    if (is_notifying_subscribers) return;
    is_notifying_subscribers = true;

    queueMicrotask(() => {
        for (let subscriber of subscriber_queue) subscriber();
        subscriber_queue.clear();
        is_notifying_subscribers = false;
    });
}

let stateid = 1;

/**
* @template {any} T
*/
export class State {

    #id = stateid++;

    /**
    * @type {T}
    */
    #value;

    /**
    * @type {Set<Function>}
    */
    #subscribers = new Set();

    #deep_proxy_subscribers = new Set();

    /**
    * @param {T} initialValue
    */
    constructor(initialValue) {
        if (is_debugger_on) __reactivity.states.add(this);

        state_proxy_listener.push(this.#deep_proxy_subscribers);
        this.value = isObject(initialValue) ? createProxy(initialValue, new Map()) : initialValue;
        state_proxy_listener.pop();
    }

    get value() {
        if (effectStack.length <= 0) return this.#value;

        const currentEffect = effectStack[effectStack.length - 1];
        this.#subscribers.add(currentEffect.effect);
        currentEffect.dependencies.add(() => this.#subscribers.delete(currentEffect.effect));

        return this.#value;
    }

    set value(newValue) {
        if (newValue === this.#value) return true;

        this.#value = newValue;

        if (this.#subscribers.size <= 0) return true;
        notifySubscribers(this.#subscribers);

        return true;
    }

    deleteState = () => {
        if (is_debugger_on) __reactivity.states.delete(this);

        this.#subscribers.clear();
        this.#value = null;
        this.#id = null;

        this.#deep_proxy_subscribers.forEach((subscriber) => subscriber());
        this.#deep_proxy_subscribers.clear();
    }
}

/**
* @template {any} T
*/
export class Derived {

    /**
    * @type {State<T>}
    */
    #state = new State(undefined);

    /**
    * @param {() => T | () => Promise<T>} callback
    */
    constructor(callback) {
        if (typeof callback !== "function") throw new TypeError("callback is not a function");

        let promiseid = -1; // used to keep track of the latest promise

        effect(() => {
            const value = callback();

            if (value instanceof Promise) {
                promiseid++;
                const current_promiseid = promiseid;

                value.then((value) => {
                    if (current_promiseid !== promiseid) return;
                    this.#state.value = value;
                    promiseid = -1;
                })

                return;
            }

            this.#state.value = value;
        });
    }

    get value() {
        return this.#state.value;
    }
}

const effectStack = [];

export function effect(callbackfn) {
    if (typeof callbackfn !== "function") throw new TypeError("callbackfn is not a function");

    const dependencies = new Set();
    let cleanup;

    function cleanupfn() {
        if (typeof cleanup === "function") cleanup();
        if (dependencies.size <= 0) return;

        // console.log('cleaniing up', callbackfn);

        for (let unsubscribe of dependencies) unsubscribe();
        dependencies.clear();
    }

    const wrappedEffect = () => {
        cleanupfn();

        effectStack.push({ effect: wrappedEffect, dependencies });

        cleanup = callbackfn();

        effectStack.pop();
    };

    wrappedEffect();

    if (is_in_untrack_from_parent_effect_scope.length > 0) {
        const untackedEffect = is_in_untrack_from_parent_effect_scope[is_in_untrack_from_parent_effect_scope.length - 1];
        untackedEffect.add(cleanupfn);
        return cleanupfn;
    }

    const parentEffect = effectStack[effectStack.length - 1];
    if (parentEffect) parentEffect.dependencies.add(cleanupfn);

    return cleanupfn;
}

let is_in_untrack_from_parent_effect_scope = [];

/**
* Effect that is detached from any parent effect
*
* It is used in `template/engine/handlerbar.js` for processing {{#each}}
*
* @param {Function} callbackfn
*/
export function untrackedEffect(callbackfn) {
    if (typeof callbackfn !== "function") throw new TypeError("callbackfn is not a function");

    is_in_untrack_from_parent_effect_scope.push(new Set());

    callbackfn();

    const dependencies = is_in_untrack_from_parent_effect_scope.pop();

    return () => {
        dependencies.forEach((dependency) => dependency());
        dependencies.clear();
    };
}

// =======================================================================

const $proxy = Symbol('PROXY');             // unique identify to prevent creating duplicate Proxies
const state_proxy_listener = [];            // push a `new Set()` and collect all subscription that happens inside a proxy for later disposal

/**
* @template {any} T
* @param {T} object
* @param {Map<any, Set<Function>>} subscriberMap
* @returns
*/
function createProxy(object, subscriberMap = new Map()) {

    Object.defineProperties(object, { [$proxy]: {} });

    const state_listener = state_proxy_listener[state_proxy_listener.length - 1];

    /**
    * @type {Map<any, Set<Function>>}
    */
    const objectSubMap = {};

    for (const key in object) {
        if (!isObject(object[key])) continue;
        objectSubMap[key] = new Map();
        object[key] = createProxy(object[key], objectSubMap[key]);
    }

    const proxy = new Proxy(object, {
        subscriberMap,
        id: makeId(12),
        get(target, key) {
            // console.log("get", target, key);

            if (effectStack.length <= 0) return target[key];
            if (!subscriberMap.has(key)) subscriberMap.set(key, new Set());

            const currentEffect = effectStack[effectStack.length - 1];
            const subscribers = subscriberMap.get(key);

            subscribers.add(currentEffect.effect);

            const unsubscribe = () => {
                subscribers.delete(currentEffect.effect)
            };

            currentEffect.dependencies.add(unsubscribe);
            state_listener.add(unsubscribe);

            return target[key];
        },
        set(target, key, new_value) {
            // console.log("Set", target[key], key, new_value);

            const subscribers = subscriberMap.get(key);

            const checIfArrayMutation = (Array.isArray(target) && typeof key === "number");
            const checkIfPrimitiveDatatypes = typeof target[key] !== "object" && target[key] === new_value;

            if (checIfArrayMutation && checkIfPrimitiveDatatypes) return true;

            if (isObject(new_value) && (!target[key] || new_value[$proxy] !== target[key][$proxy])) {

                if (state_listener) state_proxy_listener.push(state_listener);
                target[key] = createProxy(new_value, objectSubMap[key]);
                if (state_listener) state_proxy_listener.pop();

            } else {
                target[key] = new_value;
            }

            if (!subscribers || subscribers.size <= 0) return true;

            notifySubscribers(subscribers);
            return true;
        }
    })

    if (is_debugger_on) {
        __reactivity.proxies.add(proxy);
        state_listener.add(() => {
            __reactivity.proxies.delete(proxy);
        })
    }

    return proxy;
}
