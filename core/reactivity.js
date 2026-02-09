import { isObject } from "./helper-functions.js";

/** @type {Set<Function>} */
const subscriber_queue = new Set();
let is_notifying_subscribers = false;

/**
* @param {Set<Function>} subscribers
*/
function notifySubscribers(subscribers) {
    for (const subscriber of subscribers) if (!subscriber_queue.has(subscriber)) subscriber_queue.add(subscriber);
    if (is_notifying_subscribers) return;
    is_notifying_subscribers = true;
    queueMicrotask(() => {
        for (const subscriber of subscriber_queue) subscriber();
        subscriber_queue.clear();
        is_notifying_subscribers = false;
    });
}

const IS_SIGNAL = Symbol('is_signal');

/** @type {(input:any) => Boolean} */
export const isSignal = (input) => input && typeof input === "function" && input[IS_SIGNAL];

/**
 * @template {any} T
 * @param {T} initial_value
 */
export function createSignal(initial_value = undefined) {
    /** @type {T} */
    let value = isObject(initial_value) ? wrap(initial_value) : initial_value;
    const subscribers = new Set();
    const read = () => {
        if (effectStack.length <= 0) return value;

        const currentEffect = effectStack[effectStack.length - 1];
        subscribers.add(currentEffect);
        currentEffect.dependencies.add(() => subscribers.delete(currentEffect));

        return value;
    }

    /**
     * @param {T} new_value
     */
    read.set = function (new_value) {
        if (new_value === value) return

        // Preserve subscriber map of this.#value by transferring it to new_value unproxy
        if (isObject(new_value) && !new_value[IS_PROXY]) {
            const wrapped_new_value = wrap(new_value);
            new_value = wrapped_new_value;
        }

        // Cleanup if replacing this.#value (object) with a non-object new_value
        if (isObject(value) && (!isObject(new_value) || !new_value[IS_PROXY])) {
            const old_value = value[UNWRAPPED_VALUE];
            SUBSCRIBERS.deepDelete(old_value);
        }

        value = new_value;

        if (subscribers.size > 0) notifySubscribers(subscribers);
    }

    /**
     * @param {(old_value:T) => T} fn
     */
    read.update = function (fn) {
        if (typeof fn !== "function") throw new Error("callbackfn is not a function");
        read.set(fn(value));
    }

    read[IS_SIGNAL] = true;

    return read;
}

/**
 * @template {any} T
 * @param {() => T} callbackfn
 */
export function createDerived(callbackfn) {
    /** @type {T} */
    const value = undefined;
    const signal = createSignal(value);
    const read = () => signal();
    read.dispose = effect(() => signal.set(callbackfn()));
    return read;
}

/**
 * @template {any} T
 * @param {() => (T | Promise<T>)} callbackfn
 */
export function createAsyncDerived(callbackfn) {
    let last_promise_id = 0;
    /** @type {T} */
    const value = undefined;
    const read = createSignal(value);
    const error = createSignal(null);
    const pending = createSignal(false);
    read.error = () => error();
    read.pending = () => pending();
    read.dispose = effect(() => {
        const promise_id = ++last_promise_id;
        const result = callbackfn();
        if (!(result instanceof Promise)) return read.set(result);
        pending.set(true);
        result.then((value) => {
            if (last_promise_id === promise_id) read.set(value)
        }).catch((err) => {
            if (last_promise_id === promise_id) error.set(err)
        }).finally(() => {
            if (last_promise_id === promise_id) pending.set(false);
        })
    });
    return read;
}

const effectStack = [];

/**
 * @param {Function} fn
 * @returns {Function} cleanup function
 */
export function effect(fn) {
    if (typeof fn !== "function") throw new TypeError("fn is not a function");

    const dependencies = new Set();
    let cleanup;

    const cleanupfn = () => {
        if (typeof cleanup === "function") cleanup();
        for (let unsubscribe of dependencies) unsubscribe();
        dependencies.clear();
    }

    let untackedEffect = is_in_untrack_from_parent_effect_scope.pop();

    if (!untackedEffect) {
        const parentEffect = effectStack[effectStack.length - 1];
        if (parentEffect) parentEffect.dependencies.add(cleanupfn);
    } else {
        untackedEffect.add(cleanupfn);
    }

    const wrappedEffect = () => {
        cleanupfn();
        effectStack.push(wrappedEffect);
        try {
            cleanup = fn();
        } finally {
            effectStack.pop();
        }
    };
    wrappedEffect.dependencies = dependencies;

    wrappedEffect();

    if (untackedEffect) is_in_untrack_from_parent_effect_scope.push(untackedEffect);

    return cleanupfn;
}

let is_in_untrack_from_parent_effect_scope = [];

/**
* Effect that is detached from any parent effect and only run once. Only use this in special cases.
* @param {Function} fn
* @returns {Function} cleanup
*/
export function untrackedEffect(fn) {
    if (typeof fn !== "function") throw new TypeError("fn is not a function");

    is_in_untrack_from_parent_effect_scope.push(new Set());

    const cleanup = fn();
    const dependencies = is_in_untrack_from_parent_effect_scope.pop();

    return () => {
        for (let unsubscribe of dependencies) unsubscribe();
        dependencies.clear();
        if (cleanup) cleanup();
    };
}

// Keep track of deeply nested proxy subscribers
function subscriberMap() {
    /** @type {WeakMap<any, Map<any, Set<Function>>>} */
    const map = new WeakMap();

    return {
        /**
        * @param {object} target
        * @returns {Map<any, Set<Function>>}
        */
        getMap(target) {
            let keyMap = map.get(target);
            if (!keyMap) {
                keyMap = new Map();
                map.set(target, keyMap);
            }
            return keyMap;
        },
        /**
        * @param {object} target
        * @param {any} key
        * @returns {Set<Function>}
        */
        getSet(target, key) {
            const keyMap = this.getMap(target);
            let set = keyMap.get(key);
            if (!set) {
                set = new Set();
                keyMap.set(key, set);
            }
            return set;
        },
        /**
        * @param {any} target
        * @param {WeakSet} visited
        */
        deepDelete(target, visited = new WeakSet()) {
            if (!isObject(target) || visited.has(target)) return;

            visited.add(target);

            const keyMap = map.get(target);
            if (!keyMap) return;

            for (const key in target) {
                const child = target[key];
                if (!isObject(child)) continue;
                this.deepDelete(child, visited); // recurse on children
            }

            map.delete(target); // delete after children
        }
    }
}

const IS_PROXY = Symbol('is_deep_proxy');
const UNWRAPPED_VALUE = Symbol('unwrapped_value');
const SUBSCRIBERS = subscriberMap();
const SETTERGETTERCONST = ["has", "set", "get"];
const proxyCache = new WeakMap();

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

                    // console.warn(`object property "${key}" is a function, assuming it is to update some state, looping through all property of this object and notifying all effect subscribers`);

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
            if (subscribers.has(currentEffect)) return wrap(value);

            subscribers.add(currentEffect);
            currentEffect.dependencies.add(() => subscribers.delete(currentEffect));

            return wrap(value);
        },
        set(target, key, new_value) {
            let unwrapped_value = new_value;

            if (isObject(new_value)) {
                if (!new_value[IS_PROXY]) {
                    new_value = wrap(new_value);
                }
                unwrapped_value = new_value[UNWRAPPED_VALUE];
            }

            // Cleanup if replacing target[key] (object) with a non-object new_value
            if (isObject(target[key]) && (!isObject(new_value) || !new_value[IS_PROXY])) {
                SUBSCRIBERS.getMap(target).delete(key);
            }

            let arrLen;
            if (Array.isArray(target) && target[key] === undefined) arrLen = target.length;

            target[key] = unwrapped_value;

            // trigger subscribers of an array when mutating an index that has undefined value
            // like `arr = []; arr[1] = "new_value";` trigger the array as if it was a `arr.push("new_value")`
            if (Array.isArray(target) && arrLen >= 0 && arrLen !== target.length) {
                const parentArrSubscribers = SUBSCRIBERS.getSet(target, 'length');
                if (parentArrSubscribers.size > 0) notifySubscribers(parentArrSubscribers);
            }

            const subscribers = SUBSCRIBERS.getSet(target, key);
            if (subscribers.size > 0) notifySubscribers(subscribers);

            return true;
        },
        deleteProperty(target, key) {
            delete target[key];

            const subscribers = SUBSCRIBERS.getSet(target, key);
            if (subscribers.size > 0) notifySubscribers(subscribers);

            return true;
        }
    });

    proxyCache.set(obj, proxy);

    return proxy;
}
