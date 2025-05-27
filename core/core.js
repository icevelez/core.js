import { newSetFunc } from "./helper-functions.js";
import { onMountQueue, onUnmountQueue, core_context, pushPopMountUnmountSet } from "./internal-core.js"
import { effect } from "./reactivity.js";

/**
* @param {string} template_url
*/
export async function load(template_url) {
    const response = await fetch(template_url);
    return response.text();
}

/**
* @param {() => DocumentFragment} component
* @param {{ target : HTMLElement }} target
* @returns {() => void} unmount function
*/
export function mount(component, options) {
    if (typeof options !== "object") throw new TypeError("options is not an object");
    if (!(options.target instanceof HTMLElement)) throw new TypeError("options.target is not an HTMLElement");
    if (component instanceof Promise) throw new Error("component should not be an async function");

    const onMountSet = newSetFunc();
    const onUnmountSet = newSetFunc();

    const cleanup = effect(() => {
        pushPopMountUnmountSet(onMountSet, onUnmountSet, () => {
            options.target.innerHTML = "";
            options.target.appendChild(component());
        })

        for (const mount of onMountSet) mount();

        core_context.is_mounted_to_the_DOM = true;
        for (const mount of core_context.onMountSet) mount();
        core_context.onMountSet.clear();
    })

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
