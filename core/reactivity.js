import { isObject } from "./helper-functions.js";

// =======================================================================

const is_debugger_on = true;
const turn_on_warnings = false;

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

/**
* @template {any} T
*/
export class State {

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
        this.value = initialValue && typeof initialValue === "object" ? createProxy(initialValue) : initialValue;
    }

    get value() {
        if (effectStack.length <= 0) return this.#value;

        const currentEffect = effectStack[effectStack.length - 1];
        this.#subscribers.add(currentEffect.effect);

        currentEffect.dependencies.add(() => {
            this.#subscribers.delete(currentEffect.effect);

            if (!is_debugger_on) return;
            if (this.#subscribers.size > 0) return;
            __reactivity.states.delete(this);
        });

        if (is_debugger_on) __reactivity.states.add(this);

        return this.#value;
    }

    set value(new_value) {
        if (new_value === this.#value) return true;

        if (typeof new_value === "object" && !new_value[$proxy]) {
            new_value = (typeof this.#value === "object" && this.#value[$proxy]) ?
                createProxy(new_value, this.#value[$proxy].subscriberMap) :
                createProxy(new_value);
        }

        this.#value = new_value;

        if (this.#subscribers.size <= 0) {
            if (turn_on_warnings) console.warn("setting new value for State with no subscribers.\n", this);
            return true;
        }

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

const effectStack = [];

export function effect(callbackfn) {
    if (typeof callbackfn !== "function") throw new TypeError("callbackfn is not a function");

    let untackedEffect;

    if (is_in_untrack_from_parent_effect_scope.length > 0) {
        untackedEffect = is_in_untrack_from_parent_effect_scope.pop();
        untackedEffect.add(cleanupfn);
    }

    if (!untackedEffect) {
        const parentEffect = effectStack[effectStack.length - 1];
        if (parentEffect) parentEffect.dependencies.add(cleanupfn);
    }

    const dependencies = new Set();
    let cleanup;

    function cleanupfn() {
        if (typeof cleanup === "function") cleanup();
        if (dependencies.size <= 0) return;
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

    if (untackedEffect) is_in_untrack_from_parent_effect_scope.push(untackedEffect);

    return cleanupfn;
}

let is_in_untrack_from_parent_effect_scope = [];

/**
* Effect that is detached from any parent effect
* It is used in `template/engine/handlerbar.js` for processing item inside an {{#each}} block
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
const setterGetterConst = ["has", "set", "get"];

let proxy_id = 1;

/**
* @template {any} T
* @param {T} object
* @param {Map<any, Set<Function>>} subscriberMap
* @returns
*/
function createProxy(object, subscriberMap = new Map()) {

    Object.defineProperties(object, {
        [$proxy]: {
            value: {
                proxy_id: proxy_id++,
                subscriberMap,
                /**
                * @param {Map<any, Set<Function>>} new_subscriberMap
                */
                setSubscriberMap: (new_subscriberMap) => {
                    subscriberMap = new_subscriberMap;
                },
                clearProxy: () => {
                    subscriberMap.forEach((subscribers) => subscribers.clear());
                    subscriberMap.clear();
                }
            }
        }
    });

    for (const key in object) {
        if (key == $proxy) continue;
        if (!isObject(object[key])) continue;

        const objectProperty = Object.getOwnPropertyDescriptor(object, key);
        if (!objectProperty || !objectProperty.writable) {
            if (turn_on_warnings)
                console.warn(`Warning! property descriptor of "${key}" is undefined or not writable. Unable to create a proxy and using property "${key}" will not be reactive\n`, object)
            continue;
        }

        const is_object_key_proxy = object[key] && object[key][$proxy];
        if (is_object_key_proxy) continue;

        object[key] = createProxy(object[key]);
    }

    const proxy = new Proxy(object, {
        get(target, key) {
            if (key === $proxy) return target[key];

            // console.log("get", key, target[key]);

            const isFunc = !Array.isArray(target) && typeof target[key] === "function";
            const value = !isFunc ? target[key] : function (...args) {
                const return_value = target[key](...args);

                if (args.length <= 0) return return_value;
                if (setterGetterConst.includes(key) && args.length <= 1) return return_value;

                if (turn_on_warnings)
                    console.warn(`object get ${key} is a function that accepts arguments which is likely to update some state. Looping through all property of this object and notifying all effects`);

                subscriberMap.forEach((subscribers, key) => {
                    if (!subscribers) return;
                    if (subscribers.size <= 0) {
                        subscriberMap.delete(key);
                        return;
                    }
                    notifySubscribers(subscribers);
                })

                return return_value;
            }

            // source: https://stackoverflow.com/questions/47874488/proxy-on-a-date-object
            if (effectStack.length <= 0) return value;

            if (!subscriberMap.has(key)) subscriberMap.set(key, new Set());

            const currentEffect = effectStack[effectStack.length - 1];
            const subscribers = subscriberMap.get(key);

            subscribers.add(currentEffect.effect);

            const unsubscribe = () => {
                subscribers.delete(currentEffect.effect);
                if (subscribers.size > 0) return;
                subscriberMap.delete(key);

                if (!is_debugger_on) return;
                if (subscriberMap.size > 0) return;
                __reactivity.proxies.delete(proxy);
            };

            __reactivity.proxies.add(proxy);

            currentEffect.dependencies.add(unsubscribe);

            return value;
        },
        set(target, key, new_value) {
            // console.log("set", key, target[key], new_value);

            const checIfArrayMutation = (Array.isArray(target) && typeof key === "number");
            const checkIfPrimitiveDatatypes = typeof target[key] !== "object" && target[key] === new_value;

            if (checIfArrayMutation && checkIfPrimitiveDatatypes) return true;

            if (isObject(new_value) && !new_value[$proxy]) {
                target[key] = createProxy(new_value);
            } else {
                target[key] = new_value;
            }

            const subscribers = subscriberMap.get(key);
            if (!subscribers) return true;

            if (subscribers.size <= 0) {
                if (turn_on_warnings) console.warn("setting new value for State with no subscribers.\n", proxy);
                return;
            }

            notifySubscribers(subscribers);
            return true;
        },
    })

    return proxy;
}
