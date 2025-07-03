// This file exists so I don't have to export this internal variable inside "core.js"
const dev_mode_on = true;

/** @type {Map<string, Function>} */
const evaluationCache = new Map();

if (dev_mode_on) {
    window.__corejs__ = {
        version: "0.2.1",
        evaluationCache
    }
}

export const core_context = { is_mounted_to_the_DOM: false, onMountSet: new Set(), onUnmountSet: new Set() };

/** @type {Map<string, any>[]} */
export let contextQueue = [];

export function pushNewContext() {
    contextQueue.push(new Map());
    return [...contextQueue];
}

export function copyContextQueue() {
    return [...contextQueue];
}

/**
 * @param {Map<string, any[]} newContextQueue
 * @returns {() => void} revert back to the old context queue
 */
export function setContextQueue(newContextQueue) {
    const oldContextQueue = contextQueue;
    contextQueue = newContextQueue;
    return () => contextQueue = oldContextQueue;
}

/** @type {Set<Function>[]} */
export const onMountQueue = [];

/** @type {Set<Function>[]} */
export const onUnmountQueue = [];

/**
 * @param {Set<Function>} onMountSet
 * @param {Set<Function>} onUnmountSet
 * @param {Function} fn
 */
export function scopedMountUnmountRun(onMountSet, onUnmountSet, fn) {
    onUnmountQueue.push(onUnmountSet);
    onMountQueue.push(onMountSet);
    fn();
    onMountQueue.pop();
    onUnmountQueue.pop();
}

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
        evalFunc = new Function(...ctx_keys, `return ${expr};`);
        evaluationCache.set(key, evalFunc);
    }

    try {
        return evalFunc(...ctx_keys.map(k => ctx[k]));
    } catch (error) {
        console.error(error, ctx);
        throw new Error(`Evaluation run-time error: ${expr}`);
    }
}

/** @type {Map<string, WeakMap<Node, Set<Function>>>} */
const delegated_events = new Map();

/**
 * NOTE: this will create a single global listener but that global listener will stay persistent through out the app life-cycle,
 * it will not be dispose of even if there are no node listener because it's using a `WeakMap`
 * there's no way of knowing if there's zero nodes listening, so there's no way of disposing the global listener
 */
export const coreEventListener = Object.freeze({
    /**
     * @param {string} event_name
     * @param {Node} node
     * @param {Function} func
     */
    add: function (event_name, node, func) {
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

            return () => this.remove(event_name, node, func);
        }

        let funcs = event_node_weakmap.get(node);
        if (!funcs) {
            funcs = new Set();
            event_node_weakmap.set(node, funcs);
        }

        funcs.add(func);

        return () => this.remove(event_name, node, func);
    },
    /**
     *
     * @param {string} event_name
     * @param {node} node
     * @param {Function} func
     */
    remove: function remove_delegated_node(event_name, node, func = null) {
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
    for (const func of funcs) func(event);
}
