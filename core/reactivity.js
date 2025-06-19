import { isObject } from "./helper-functions.js";

/**
* @type {Set<Function>}
*/
const subscriber_queue = new Set();

let is_notifying_subscribers = false;

/**
* @param {Set<Function>} subscribers
*/
function notifySubscribers(subscribers) {
    for (let subscriber of subscribers) {
        if (subscriber_queue.has(subscriber)) continue;
        subscriber_queue.add(subscriber);
    }

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
        this.value = initialValue && typeof initialValue === "object" ? createDeepProxy(initialValue) : initialValue;
    }

    get value() {
        if (effectStack.length <= 0) return this.#value;

        const currentEffect = effectStack[effectStack.length - 1];
        this.#subscribers.add(currentEffect.effect);

        currentEffect.dependencies.add(() => {
            this.#subscribers.delete(currentEffect.effect);
        });

        return this.#value;
    }

    set value(new_value) {
        if (new_value === this.#value) return true;

        // Preserve subscriber map of this.#value by transferring it to new_value unproxy
        if (isObject(new_value) && !new_value[IS_PROXY]) {
            const wrapped_new_value = createDeepProxy(new_value);
            new_value = wrapped_new_value;
        }

        // Cleanup if replacing this.#value (object) with a non-object new_value
        if (isObject(this.#value) && (!isObject(new_value) || !new_value[IS_PROXY])) {
            const old_value = this.#value[UNWRAPPED_VALUE];
            SUBSCRIBERS.deepDelete(old_value);
        }

        this.#value = new_value;

        if (this.#subscribers.size > 0) notifySubscribers(this.#subscribers);

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
     * @type {() => void}
     */
    dispose;

    /**
    * @param {() => T} callback
    */
    constructor(callback) {
        if (typeof callback !== "function") throw new TypeError("callback is not a function");
        this.dispose = effect(() => {
            const value = callback();
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
        try {
            cleanup = callbackfn();
        } finally {
            effectStack.pop();
        }
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

class SubscriberMap {
    map = new WeakMap(); // target -> Map<property, Set<Function>>

    constructor() { }

    /**
    * @param {object} target
    * @returns {Map<any, Set<Function>>}
    */
    getMap(target) {
        let keyMap = this.map.get(target);
        if (!keyMap) {
            keyMap = new Map();
            this.map.set(target, keyMap);
        }

        return keyMap;
    }

    /**
    * @param {object} target
    * @param {any} key
    * @returns {Set<Function>}
    */
    getSet(target, key) {
        let keyMap = this.map.get(target);
        if (!keyMap) {
            keyMap = new Map();
            this.map.set(target, keyMap);
        }

        let set = keyMap.get(key);
        if (!set) {
            set = new Set();
            keyMap.set(key, set);
        }

        return set;
    }

    transferMap(fromTarget, toTarget) {
        const keyMap = this.map.get(fromTarget);
        if (keyMap) this.map.set(toTarget, keyMap);
    }

    deepDelete(target, visited = new WeakSet()) {
        if (!isObject(target) || visited.has(target)) return;

        visited.add(target);

        const keyMap = this.map.get(target);
        if (!keyMap) return;

        for (const key in target) {
            const child = target[key];
            if (!isObject(child)) continue;
            this.deepDelete(child, visited); // recurse on children
        }

        this.map.delete(target); // delete after children
    }
}

const IS_PROXY = Symbol('is_deep_proxy');
const UNWRAPPED_VALUE = Symbol('unwrapped_value');
const SUBSCRIBERS = new SubscriberMap();
const SETTERGETTERCONST = ["has", "set", "get"];

const proxyCache = new WeakMap();

export function createDeepProxy(target) {
    /**
    * @param {any} obj
    */
    function wrap(obj) {
        if (typeof obj !== 'object' || obj === null) return obj;

        // Avoid re-wrapping a previously created deep proxy
        if (obj[IS_PROXY]) return obj;

        // Avoid wrapping same object multiple times
        if (proxyCache.has(obj)) return proxyCache.get(obj);

        const proxy = new Proxy(obj, {
            get(target, key) {
                if (key === IS_PROXY) return true;
                if (key === UNWRAPPED_VALUE) return target;

                let value = target[key];

                if (typeof key === 'symbol') return value;

                if (!Array.isArray(target) && typeof value === "function") {
                    value = function (...args) {
                        const return_value = target[key](...args);

                        if (args.length <= 0) return return_value;
                        if (SETTERGETTERCONST.includes(key) && args.length <= 1) return return_value;

                        console.warn(`object property "${key}" is a function, assuming it is to update some state, looping through all property of this object and notifying all effect subscribers`);

                        const subscriberMap = SUBSCRIBERS.getMap(target);

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
                }

                const currentEffect = effectStack[effectStack.length - 1];
                if (!currentEffect) return wrap(value);

                const subscribers = SUBSCRIBERS.getSet(target, key);
                if (subscribers.has(currentEffect.effect)) return wrap(value);

                subscribers.add(currentEffect.effect);
                currentEffect.dependencies.add(() => subscribers.delete(currentEffect.effect));

                return wrap(value);
            },
            set(target, key, new_value) {
                // console.log('set', target, key, new_value);

                let unwrapped_value = new_value;

                if (isObject(new_value)) {
                    if (!new_value[IS_PROXY]) {
                        new_value = createDeepProxy(new_value);
                    }
                    unwrapped_value = new_value[UNWRAPPED_VALUE];
                }

                // Cleanup if replacing target[key] (object) with a non-object new_value
                if (isObject(target[key]) && (!isObject(new_value) || !new_value[IS_PROXY])) {
                    SUBSCRIBERS.getMap(target).delete(key);
                    SUBSCRIBERS.deepDelete(target[key]);
                }

                target[key] = unwrapped_value;

                const subscribers = SUBSCRIBERS.getSet(target, key);
                if (subscribers.size > 0) notifySubscribers(subscribers);

                return true;
            },
            deleteProperty(target, key) {
                if (isObject(target[key])) {
                    SUBSCRIBERS.getMap(target).delete(key);
                    SUBSCRIBERS.deepDelete(target[key]);
                }

                delete target[key];
                return true;
            }
        });

        proxyCache.set(obj, proxy);

        return proxy;
    }

    return wrap(target);
}
