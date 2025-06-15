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
* @param {string} expr
* @param {any} ctx
* @returns {any}
*/
export function evaluate(expr, ctx) {
    if (!expr || typeof expr !== "string") return undefined;

    const ctx_keys = Object.keys(ctx);
    const key = `${expr}::${ctx_keys.join(',')}`;

    let evalFunc = evaluationCache.get(key);
    if (!evalFunc) {
        evalFunc = Function(...ctx_keys, `return ${expr};`);
        evaluationCache.set(key, evalFunc);
    }

    try {
        return evalFunc(...ctx_keys.map(k => ctx[k]));
    } catch (e) {
        console.error(`Evaluation run-time error: ${expr}`, e, ctx);
        return {};
    }
}
