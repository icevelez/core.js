export { onMount, onUnmount, setContext, getContext } from "./internal.js";

/**
* @param {string} template_url
*/
export async function load(template_url) {
    return fetch(template_url).then((response) => response.text());
}
