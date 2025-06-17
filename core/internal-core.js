// This file exists so I don't have to export this internal variable inside "core.js"

const dev_mode_on = true;

const evaluationCache = new Map();

if (dev_mode_on) {
    window.__corejs__ = {
        version: "0.1.7",
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

/**
 * @type {Map<string, WeakMap<Node, Set<Function>>>}
 */
const delegated_events = new Map();

export const event_delegation = Object.freeze({
    /**
     * @param {string} event_name
     * @param {Node} node
     * @param {Function} func
     */
    addListener: function (event_name, node, func) {
        let event_node_weakmap = delegated_events.get(event_name);

        if (!event_node_weakmap) {
            event_node_weakmap = new WeakMap();
            const funcs = new Set();
            funcs.add(func);

            event_node_weakmap.set(node, funcs);
            delegated_events.set(event_name, event_node_weakmap);

            window.addEventListener(event_name, (e) => {
                match_delegated_node(event_node_weakmap, e, e.target);
            });

            return;
        }

        let funcs = event_node_weakmap.get(node);
        if (!funcs) {
            funcs = new Set();
            event_node_weakmap.set(node, funcs);
        }
        funcs.add(func);
    },
    /**
     *
     * @param {string} event_name
     * @param {node} node
     * @param {Function} func
     */
    removeListener: function remove_delegated_node(event_name, node, func = null) {
        const event = delegated_events.get(event_name);
        if (!event) return;
        const funcs = event.get(node);
        if (!funcs) return;
        funcs.delete(func);
    }
})

/**
 * Traverse event.target to event.target.parentNode recursively until a WeakMap<Node> matches, if not, return void, if has, run functions
 * @param {WeakMap<Node, Set<Function>>} event_node_weakmap
 * @param {Event} event
 * @param {Node} target
 */
function match_delegated_node(event_node_weakmap, event, target) {
    const funcs = event_node_weakmap.get(target);
    if (!funcs) {
        if (!target.parentNode) return;
        return match_delegated_node(event_node_weakmap, event, target.parentNode);
    }

    for (const func of funcs) {
        func(event);
    }
}
