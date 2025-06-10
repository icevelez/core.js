import { onMountQueue, onUnmountQueue, core_context } from "./internal-core.js";
import { effect } from "./reactivity.js";
import { isObject, newSetFunc } from "./helper-functions.js";

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

    const onMountSet = newSetFunc();
    const onUnmountSet = newSetFunc();

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
* @param {Function} callback
*/
export function onMount(callback) {
    if (typeof callback !== "function") throw new TypeError("callback is not a function");
    const onMount = onMountQueue[onMountQueue.length - 1];
    if (!onMount) throw new Error("no mount set has been created");
    onMount.add(callback);
}

/**
* @param {Function} callback
*/
export function onUnmount(callback) {
    if (typeof callback !== "function") throw new TypeError("callback is not a function");
    const onUnmount = onUnmountQueue[onUnmountQueue.length - 1];
    if (!onUnmount) throw new Error("no unmount set has been created");
    onUnmount.add(callback);
}
