import { isObject, makeId } from "./helper-functions.js";

/** @type {Set<Function>} */
const subscriber_queue = new Set();

let is_notifying_subscribers = false;

/**
* @param {Set<Function>} subscribers
*/
function notifySubscribers(subscribers) {
    for (const subscriber of subscribers) {
        if (subscriber_queue.has(subscriber)) continue;
        subscriber_queue.add(subscriber);
    }

    if (is_notifying_subscribers) return;
    is_notifying_subscribers = true;

    queueMicrotask(() => {
        for (const subscriber of subscriber_queue) subscriber();
        subscriber_queue.clear();
        is_notifying_subscribers = false;
    });
}

const IS_SIGNAL = Symbol('is_signal');

/**
 * @template {any} T
 * @param {() => T} func
 * @returns {{ () => T, set : (new_value:T) => void, update : ((callbackfn:(old_value:T) => T) => void, [IS_SIGNAL] : boolean }}
 */
export function makeFuncSignal(func) {
    if (typeof func !== "function") throw new Error("func is not a function");
    func[IS_SIGNAL] = true;
    return func;
}

/**
 * @param {any} input
 * @returns {boolean}
 */
export function isSignal(input) {
    return input && typeof input === "function" && input[IS_SIGNAL];
}

/**
 * @template {any} T
 * @param {T} initial_value
 */
export function createSignal(initial_value = undefined) {
    /** @type {T} */
    let value;
    const subscribers = new Set();

    if (isObject(initial_value)) {
        value = createDeepProxy(initial_value)
    } else {
        value = initial_value;
    }

    function read() {
        if (effectStack.length <= 0) return value;

        const currentEffect = effectStack[effectStack.length - 1];
        subscribers.add(currentEffect);

        currentEffect.dependencies.add(() => subscribers.delete(currentEffect));

        return value;
    }

    /**
     * @param {T} new_value
     */
    function write(new_value) {
        if (new_value === value) return

        // Preserve subscriber map of this.#value by transferring it to new_value unproxy
        if (isObject(new_value) && !new_value[IS_PROXY]) {
            const wrapped_new_value = createDeepProxy(new_value);
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
     * @param {(old_value:T) => T} callbackfn
     */
    function update(callbackfn) {
        if (typeof callbackfn !== "function") throw new Error("callbackfn is not a function");
        write(callbackfn(value));
    }

    read.set = write;
    read.update = update;
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

    function read() {
        return signal();
    }

    read.dispose = effect(() => signal.set(callbackfn()));

    return read;
}

/**
 * @template {any} T
 * @param {() => Promise<T>} promise_callbackfn
 */
export function createAsyncDerived(promise_callbackfn) {
    /** @type {T} */
    const value = undefined;
    const signal = createSignal(value);

    function read() {
        return signal();
    }

    let currentPromiseId;

    read.dispose = effect(() => {
        const promiseId = makeId(6);
        currentPromiseId = promiseId;

        promise_callbackfn()
            .then((value) => {
                if (currentPromiseId !== promiseId) return;
                signal.set(value);
            })
            .catch((error) => {
                if (currentPromiseId !== promiseId) return;
                signal.set(error);
            })
    });

    return read;
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
        effectStack.push(wrappedEffect);
        try {
            cleanup = callbackfn();
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
* Effect that is detached from any parent effect.
* It is used in `template-engine/handlerbar.js` for processing an item inside an array of an `{{#each}}` block
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
                deepDelete(child, visited); // recurse on children
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
                    new_value = createDeepProxy(new_value);
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

function createDeepProxy(target) {
    return wrap(target);
}
