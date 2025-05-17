// ==========================================
// For debugging purposes

const is_debugger_on = true;

const __reactivity = {
    states: [],
    proxies: new Map(),
    effect_queue: new Set(),
    running_effects: [],
}

if (is_debugger_on) window.__reactivity = __reactivity;

// ==========================================

/**
* @type {{ effect : Function, effect_subscribers : Set<Function>, cleanups : Set<Function> }[]}
*/
const running_effects = (is_debugger_on) ? __reactivity.running_effects : [];

/**
* @type {Set<Function>}
*/
const effect_queue = (is_debugger_on) ? __reactivity.effect_queue : new Set();

let isEffectRunning = false;

/**
* @param {Set<Function>} effects_to_run
* @returns
*/
function runEffect(effects_to_run) {
    for (let effect of effects_to_run) effect_queue.add(effect);

    if (isEffectRunning) return;
    isEffectRunning = true;

    queueMicrotask(() => {
        for (let effect of effect_queue) effect();
        effect_queue.clear();
        isEffectRunning = false;
    });
}

let stateid = 1;

/**
* @template {any} T
*/
export class State {

    #id = stateid;

    /**
    * @type {T}
    */
    #value;

    /**
    * @type {Set<Function>}
    */
    #subscribers = new Set();

    /**
    * @param {T} value
    */
    constructor(value) {
        if (is_debugger_on) __reactivity.states.push(this);

        this.#id = stateid;
        stateid++;

        this.#value = isObject(value) ? createProxy(value, new Map(), [`State#${this.#id}`]) : value;
    }

    get value() {
        const current_effect = running_effects[running_effects.length - 1];
        if (!current_effect) return this.#value;

        this.#subscribers.add(current_effect.effect);
        current_effect.effect_subscribers.add(() => this.#subscribers.delete(current_effect.effect));

        return this.#value;
    }

    set value(new_value) {
        if (this.#value === new_value) return true;

        this.#value = new_value;
        runEffect(this.#subscribers);
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
    #state = new State(null);

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

/**
* @param {Function} callback
*/
export function effect(callback) {
    if (typeof callback !== "function") throw new TypeError("callback is not a function");

    const current_effect = {
        effect: null,
        effect_subscribers: new Set(),
        cleanups: new Set()
    };

    const cleanup = () => {
        if (current_effect.cleanups.size <= 0) return;
        for (const cleanup of current_effect.cleanups) cleanup();
        current_effect.cleanups.clear();
    }

    const unsubscribe = () => {
        // console.log("unsubscribing");
        for (const unsubscribe of current_effect.effect_subscribers) unsubscribe();
        current_effect.effect_subscribers.clear();
    }

    const wrappedEffect = () => {
        cleanup();
        unsubscribe();

        current_effect.effect = wrappedEffect;
        running_effects.push(current_effect);

        const effect_cleanup = callback();
        if (typeof effect_cleanup === "function") current_effect.cleanups.add(effect_cleanup)

        running_effects.pop();
    }

    wrappedEffect();

    const parent_effect = running_effects[running_effects.length - 1];
    if (!parent_effect) return unsubscribe;

    parent_effect.effect_subscribers.add(unsubscribe);
    parent_effect.cleanups.add(cleanup);

    return unsubscribe;
}

// ==========================

function isObject(object) {
    return object && typeof object === "object";
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
            const current_effect = running_effects[running_effects.length - 1];
            if (!current_effect) return target[key];

            if (!subscriberMap.has(key)) subscriberMap.set(key, new Set());

            const subscribers = subscriberMap.get(key);
            subscribers.add(current_effect.effect);

            current_effect.effect_subscribers.add(() => {
                subscribers.delete(current_effect.effect)
            });

            // FUCK YOU ICE
            // DO NOT DELETE. IMPORTANT CODE TO DEBUG AND MANUALLY KEEP TRACK OF SUBSCRIBERS WHEN DEBUGGING
            // UNCOMMENT TO DEBUG
            // setTimeout(() => {
            //     console.log('sub', key, subscribers);
            // }, 2000)

            return target[key];
        },
        set(target, key, new_value) {
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
            runEffect(subscribers);
            return true;
        }
    })
}
