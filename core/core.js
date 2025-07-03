import { onMountQueue, onUnmountQueue, core_context, contextQueue } from "./internal-core.js";
import { effect } from "./reactivity.js";
import { isObject } from "./helper-functions.js";

let isMounted = false;

/**
* @param {string} template_url
*/
export async function load(template_url) {
    const response = await fetch(template_url);
    return response.text();
}

/**
* @param {() => DocumentFragment} component
* @param {{ target : HTMLElement }} options
* @returns {() => void} unmount function
*/
export function mount(component, options) {
    if (isMounted) throw new Error("cannot mount twice");
    if (!isObject(options)) throw new TypeError("options is not an object");
    if (!(options.target instanceof HTMLElement)) throw new TypeError("options.target is not an HTMLElement");
    if (typeof component !== "function") throw new Error("component is not a function");

    const onMountSet = new Set();
    const onUnmountSet = new Set();

    const cleanup = effect(() => {

        onUnmountQueue.push(onUnmountSet);
        onMountQueue.push(onMountSet);

        const fragment = component();
        if (!(fragment instanceof DocumentFragment)) throw new Error("component is not a DocumentFragment");
        options.target.appendChild(fragment);

        onMountQueue.pop();
        onUnmountQueue.pop();

        for (const mount of onMountSet) mount();

        core_context.is_mounted_to_the_DOM = true;
        for (const mount of core_context.onMountSet) mount();
        core_context.onMountSet.clear();
    })

    isMounted = true;

    return () => {
        cleanup();
        onUnmountSet.forEach((unmount) => unmount());
        onUnmountSet.clear();
        for (const unmount of core_context.onUnmountSet) unmount();
        core_context.onUnmountSet.clear();
    };
}

/**
* Callback function that is executed when a component is rendered to the DOM
* @param {Function} callback
*/
export function onMount(callback) {
    if (typeof callback !== "function") throw new TypeError("callback is not a function");
    const onMount = onMountQueue[onMountQueue.length - 1];
    if (!onMount) throw new Error("no mount set has been created");
    onMount.add(callback);
}

/**
* Callback function that is executed before a component is removed from the DOM
* @param {Function} callback
*/
export function onUnmount(callback) {
    if (typeof callback !== "function") throw new TypeError("callback is not a function");
    const onUnmount = onUnmountQueue[onUnmountQueue.length - 1];
    if (!onUnmount) throw new Error("no unmount set has been created");
    onUnmount.add(callback);
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
