import { isObject } from "./helper-functions.js";

const is_debugger_on = true;

const __reactivity = {
    states: [],
    proxies: new Map(),
    subscriber_queue: new Set(),
    effectStack: [],
}

/**
* @type {Set<Function>}
*/
const subscriber_queue = (is_debugger_on) ? __reactivity.subscriber_queue : new Set();

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

    /**
    * @param {T} initialValue
    */
    constructor(initialValue) {
        if (is_debugger_on) __reactivity.states.push(this);

        this.value = isObject(initialValue) ? createProxy(initialValue, new Map(), [`State#${this.#id}`]) : initialValue;
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

const effectStack = (is_debugger_on) ? __reactivity.effectStack : [];

export function effect(callbackfn) {
    if (typeof callbackfn !== "function") throw new TypeError("callbackfn is not a function");

    const dependencies = new Set();
    let cleanup;

    function cleanupfn() {
        for (let unsubscribe of dependencies) unsubscribe();
        dependencies.clear();
        if (typeof cleanup === "function") cleanup();
    }

    const wrappedEffect = () => {
        cleanupfn();

        effectStack.push({ effect: wrappedEffect, dependencies });

        cleanup = callbackfn();

        effectStack.pop();
    };

    wrappedEffect();

    if (is_in_untrack_from_parent_effect_scope) return cleanupfn;

    const parentEffect = effectStack[effectStack.length - 1];
    if (parentEffect) parentEffect.dependencies.add(cleanupfn);

    return cleanupfn;
}

let is_in_untrack_from_parent_effect_scope = false;

/**
* Used internally in "handlerbar.js" {{#each}} processing to prevent the parent effect from unsubscribing the existing DOM element subscription
* @param {Function} callbackfn
*/
export function untrack_from_parent_effect(callbackfn) {
    if (typeof callbackfn !== "function") throw new TypeError("callbackfn is not a function");
    is_in_untrack_from_parent_effect_scope = true;
    const result = callbackfn();
    is_in_untrack_from_parent_effect_scope = false;
    return result;
}

/**
* @template {any} T
* @param {T} object
* @param {Map<any, Set<Function>>} subscriberMap
* @param {string[]} key_tree do not delete, this is for debugging purposes, showing the keys access of an object
* @returns
*/
function createProxy(object, subscriberMap = new Map(), key_tree) {
    /**
    * @type {Map<any, Set<Function>>}
    */
    const objectSubMap = {};

    if (is_debugger_on) __reactivity.proxies.set(key_tree.join("."), { subscriberMap, object });

    for (const key in object) {
        if (!isObject(object[key])) continue;
        objectSubMap[key] = new Map();
        object[key] = createProxy(object[key], objectSubMap[key], [...key_tree, key]);
    }

    return new Proxy(object, {
        get(target, key) {
            // console.log("get", target, key);

            if (effectStack.length <= 0) return target[key];
            if (!subscriberMap.has(key)) subscriberMap.set(key, new Set());

            const currentEffect = effectStack[effectStack.length - 1];
            const subscribers = subscriberMap.get(key);

            subscribers.add(currentEffect.effect);
            currentEffect.dependencies.add(() => subscribers.delete(currentEffect.effect));

            return target[key];
        },
        set(target, key, new_value) {
            // console.log("set", target, key, new_value);

            const checIfArrayMutation = (Array.isArray(target) && typeof key === "number");
            const checkIfPrimitiveDatatypes = typeof target[key] !== "object" && target[key] === new_value;

            if (checIfArrayMutation && checkIfPrimitiveDatatypes) return true;

            if (isObject(new_value)) {
                target[key] = createProxy(new_value, objectSubMap[key], [...key_tree, key]);
            } else {
                target[key] = new_value;
            }

            const subscribers = subscriberMap.get(key);
            if (!subscribers || subscribers.size <= 0) return true;

            notifySubscribers(subscribers);
            return true;
        }
    })
}

if (is_debugger_on) window.__reactivity = __reactivity;
