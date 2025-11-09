/**
* @param {string} template_url
*/
export async function load(template_url) {
    return fetch(template_url).then((response) => response.text());
}

/** @type {Set<Function>[]} */
export const onMountQueue = [];
/** @type {Set<Function>[]} */
export const onUnmountQueue = [];
/** @type {Map<string, any>[]} */
export let contextQueue = [];

/**
* Execute a callback function when a component is rendered to the DOM
* @param {Function} callback
*/
export function onMount(callback) {
    if (typeof callback !== "function") throw new TypeError("callback is not a function");
    const onMount = onMountQueue[onMountQueue.length - 1];
    if (!onMount) throw new Error("no mount set has been created");
    onMount.add(callback);
}

/**
* Execute a callback function "before" a component is removed from the DOM
* @param {Function} callback
*/
export function onUnmount(callback) {
    if (typeof callback !== "function") throw new TypeError("callback is not a function");
    const onUnmount = onUnmountQueue[onUnmountQueue.length - 1];
    if (!onUnmount) throw new Error("no unmount set has been created");
    onUnmount.add(callback);
}

/**
 * @param {Function} cb
 */
export function mountWrapper(cb) {
    onMountQueue.push(new Set());
    onUnmountQueue.push(new Set());

    const cleanup = cb();
    const onMountFns = onMountQueue.pop();
    const onUnountFns = onUnmountQueue.pop();

    const mount = () => {
        if (!onMountFns) return;
        for (const mount of onMountFns) {
            const unmount = mount();
            if (typeof unmount === "function") onUnountFns.add(unmount)
        };
    }

    const parentOnMountQueue = onMountQueue[onMountQueue.length - 1];
    if (parentOnMountQueue) parentOnMountQueue.add(mount); else mount();

    const unmount = () => {
        if (onUnountFns) {
            for (const unmount of onUnountFns) unmount();
            onUnountFns.clear();
        }
        if (cleanup) cleanup();
    }

    const parentOnUnmountQueue = onUnmountQueue[onUnmountQueue.length - 1];
    if (parentOnUnmountQueue) parentOnUnmountQueue.add(unmount);

    return unmount;
}

/**
 * @param {string} key
 * @param {any} value
 */
export function setContext(key, value) {
    let context = contextQueue[contextQueue.length - 1];
    if (!context) throw new Error("context queue is empty");
    context.set(key, value);
}

/**
 * @param {string} key
 */
export function getContext(key) {
    for (let i = contextQueue.length - 1; i >= 0; i--) {
        const value = contextQueue[i].get(key);
        if (value) return value;
    }
    return undefined;
}

/**
 * @template {any} T
 * @param {() => T} cb
 * @returns {T}
 */
export function contextWrapper(cb) {
    const previous_context = contextQueue;
    contextQueue = [...contextQueue, new Map()];
    const cleanup = cb();
    onUnmount(() => {
        contextQueue = previous_context;
        cleanup();
    })
}

export function copyContext() {
    return [...contextQueue];
}

export function setNewContext(context) {
    const previous_context = contextQueue;
    contextQueue = context;
    return () => contextQueue = previous_context;
}
