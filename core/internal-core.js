// This file exists so I don't have to export this internal variable inside "core.js"

const dev_mode_on = true;

const evaluationCache = new Map();

if (dev_mode_on) {
    window.__corejs__ = {
        version: "0.1.6",
        evaluationCache
    }
}

export const core_context = { is_mounted_to_the_DOM: false, onMountSet: new Set(), onUnmountSet: new Set() };

/**
* @type {Set<Function>[]}
*/
export const onMountQueue = [];

/**
* @type {Set<Function>[]}
*/
export const onUnmountQueue = [];

/**
* @param {Set<Function>} onMountSet
* @param {Set<Function>} onUnmountSet
* @param {Function} callbackfn
*/
export function pushPopMountUnmountSet(onMountSet, onUnmountSet, callbackfn) {
    if (typeof callbackfn !== "function") throw new Error("callbackfn is not a function");

    onUnmountQueue.push(onUnmountSet);
    onMountQueue.push(onMountSet);

    callbackfn();

    return [onMountQueue.pop(), onUnmountQueue.pop()]
}

/**
* @param {string} expr
* @param {any} ctx
* @returns {any}
*/
export function evaluate(expr, ctx) {
    const key = `${Object.keys(ctx).join(",")} ${expr}`;
    let evalFunc = evaluationCache.get(key)
    if (!evalFunc) {
        evalFunc = Function(...Object.keys(ctx), `return (${expr});`);
        evaluationCache.set(key, evalFunc);
    }

    try {
        return evalFunc(...Object.values(ctx));
    } catch (e) {
        console.error(`Evaluation error: ${expr}`, e, ctx);
        return {};
    }
}
