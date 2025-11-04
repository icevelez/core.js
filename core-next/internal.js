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
 * @returns {[any, Function]}
 */
export function mountWrapper(cb) {
    onMountQueue.push(new Set())
    const value = cb();
    const onMountFns = onMountQueue.pop();
    const unmount_cleanup = [];
    for (const mount of onMountFns) {
        const unmount = mount();
        if (typeof unmount === "function") unmount_cleanup.push(unmount)
    };
    const unmount = () => {
        for (const unmount of unmount_cleanup) unmount();
        unmount_cleanup.length = 0;
    }
    return [value, unmount];
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
    contextQueue.push(new Map());
    const current_context = [...contextQueue]
    onMount(() => contextQueue = current_context);
    const value = cb();
    onMount(() => contextQueue = previous_context);
    return value;
}
