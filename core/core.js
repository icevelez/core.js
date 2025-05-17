import { onMountQueue, onUnMountQueue } from "./internal-core.js"

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
    const unmount = onUnMountQueue.pop();
    const onMount = onMountQueue.pop();
    if (onMount) onMount();

    return unmount;
}

/**
* @param {Function} callback
*/
export function onMount(callback) {
    if (typeof callback !== "function") throw new TypeError("callback is not a function");
    onMountQueue.push(callback);
}

/**
* @param {Function} callback
*/
export function onUnmount(callback) {
    if (typeof callback !== "function") throw new TypeError("callback is not a function");
    onUnMountQueue.push(callback);
}
