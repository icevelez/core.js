import { onMountQueue, onUnmountQueue, core_context } from "./internal-core.js"

/**
* @param {string} component_url
*/
export async function load(component_url) {
    const response = await fetch(component_url);
    return response.text();
}

/**
* @param {() => DocumentFragment} component
* @param {{ target : HTMLElement }} target
*/
export function mount(component, options) {
    if (typeof options !== "object") throw new TypeError("options is not an object");
    if (!(options.target instanceof HTMLElement)) throw new TypeError("options.target is not an HTMLElement");
    if (component instanceof Promise) throw new Error("component should not be an async function");

    options.target.innerHTML = "";
    options.target.appendChild(component());
    const unMountSet = onUnmountQueue.pop();
    const mountSet = onMountQueue.pop();

    mountSet.forEach((mount) => mount());

    core_context.mounted = true;
    core_context.mounts.forEach((mount) => mount());
    core_context.mounts.clear();

    return () => {
        unMountSet.forEach((unmount) => unmount());
        unMountSet.clear();
    };
}

/**
* @param {Function} callback
*/
export function onMount(callback) {
    if (typeof callback !== "function") throw new TypeError("callback is not a function");
    const onMount = onMountQueue[onMountQueue.length - 1];
    if (!onMount) throw new Error("no unmount set has been created");
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
