import { escapeTemplateLiteral } from "./helper-functions.js";
import { createSignal, effect, untrackedEffect } from "./reactivity.js";

const $ = Object.freeze({
    /** @type {DocumentFragment[]} */
    fragment_cache: [],
    /** @type {Map<string, ({ fns : Function[], exprs : string[] } | { fn : Function, expr : string } | { pending_fn : Function, then_fn?: Function, catch_fn?: Function, expr : string })[]>} */
    block_cache: new Map(),
    /** @type {Map<string, Function>} */
    imported_components: new Map(),
    /** @type {WeakMap<DocumentFragment, []>} */
    fn_cache: new WeakMap(),
    /** @type {Map<string, WeakMap<Node, Set<Function>>>} */
    delegated_events: new Map(),
    eval: function (expr, keys) {
        return new Function(...keys, `return ${expr};`);
    },
    set_text: function (node, text) {
        if (node.__cacheText === text) return;
        node.__cacheText = node.textContent = text;
    },
    set_attr: function (node, attr, property) {
        if (!node.__cacheAttr) node.__cacheAttr = {};
        if (node.__cacheAttr[property] === attr) return;
        node.__cacheAttr[property] = attr;
        if (property === "value") {
            node.value = attr;
        } else if (attr === "false" || !attr) {
            node.removeAttribute(property);
        } else {
            node.setAttribute(property, attr === "true" ? "" : attr);
        }
    },
    effect: effect,
    delegate: function (event_name, node, func) {
        if (typeof func !== "function") throw new Error("func is not a function");
        let event_node_weakmap = $.delegated_events.get(event_name);

        if (!event_node_weakmap) {
            event_node_weakmap = new WeakMap();
            const funcs = new Set();
            funcs.add(func);

            event_node_weakmap.set(node, funcs);
            $.delegated_events.set(event_name, event_node_weakmap);

            window.addEventListener(event_name, (e) => match_delegated_node(event_node_weakmap, e, e.target));

            return () => funcs.delete(func);
        }

        let funcs = event_node_weakmap.get(node);
        if (!funcs) {
            funcs = new Set();
            event_node_weakmap.set(node, funcs);
        }

        funcs.add(func);
        return () => funcs.delete(func);
    },
    is_signal: function (signal) {
        return typeof signal === "function" && typeof signal.set === "function";
    },
    remove_nodes_between: function (startNode, endNode) {
        if (startNode.nextSibling === endNode) return;
        let node = startNode.nextSibling;
        while (node && node !== endNode) {
            const next = node.nextSibling;
            node.parentNode.removeChild(node);
            node = next;
        }
    },
    if: function (node, fns, condtion_fns, ctx, ctxValues) {
        let prev_fn, unmount;

        const fragment = document.createDocumentFragment();
        const anchor = new Text("");
        node.parentNode.replaceChild(anchor, node);

        return effect(() => {
            if (unmount) unmount();
            let curr_fn;

            for (let i = 0; i < condtion_fns.length; i++) {
                if (!condtion_fns[i](...ctxValues)) continue;
                curr_fn = fns[i];
                break;
            }

            if (prev_fn === curr_fn) return;
            prev_fn = curr_fn;
            if (!curr_fn) return;

            unmount = curr_fn(fragment, ctx);
            anchor.before(fragment);
        })
    },
    each: function (node, fn, else_fn, sub_ctx_value_fn, sub_ctx_key, sub_ctx_keys, index_key, ctx, ctxValues) {
        let is_empty_block_mounted = false;
        let else_block_cleanup, blocks = [];

        const fragment = document.createDocumentFragment();
        const anchor = new Text("");
        node.parentNode.replaceChild(anchor, node);

        return effect(() => {
            fragment.textContent = "";

            const arr = sub_ctx_value_fn(...ctxValues);

            if (arr.length <= 0) {
                for (const block of blocks) block.cleanup();
                blocks.length = 0;

                if (!else_fn || is_empty_block_mounted) return;
                is_empty_block_mounted = true;

                else_block_cleanup = else_fn(fragment, ctx);
                anchor.before(fragment);
                return;
            }

            if (else_block_cleanup) else_block_cleanup();
            is_empty_block_mounted = false;

            const new_blocks = [];

            let i = -1;
            for (const ar of arr) {
                i++;

                if (blocks[i]) {
                    if (blocks[i].data() !== ar) blocks[i].data.set(ar);
                    new_blocks.push(blocks[i]);
                    continue;
                }

                const data = createSignal(ar), sub_ctx = { ...ctx };

                if (sub_ctx_keys && sub_ctx_keys.length > 0) {
                    for (const sub_ctx_key of sub_ctx_keys) sub_ctx[sub_ctx_key] = () => data()[sub_ctx_key];
                } else {
                    sub_ctx[sub_ctx_key] = data;
                }
                if (index_key) sub_ctx[index_key] = i;

                const cleanup = untrackedEffect(() => fn(fragment, sub_ctx));
                new_blocks.push({ data, cleanup });
            }

            for (let i = new_blocks.length; i < blocks.length; i++) blocks[i].cleanup();

            blocks.length = 0;
            blocks = new_blocks;
            anchor.before(fragment);
        })
    },
    await: function (node, pending_fn, then_fn, then_key, catch_fn, catch_key, promise_fn, ctx, ctxValues) {
        let promise_cleanup_fn, final_cleanup_fn;
        const cleanup_fn = () => promise_cleanup_fn();

        const fragment = document.createDocumentFragment();
        const anchor = new Text("");
        node.parentNode.replaceChild(anchor, node);

        let latest_promise_id = Math.random();

        return effect(() => {
            const promise = promise_fn(...ctxValues);
            const current_promise_id = Math.random();
            latest_promise_id = current_promise_id;

            if (!(promise instanceof Promise)) {
                promise_cleanup_fn = then_fn(fragment, { ...ctx, [then_key]: promise });
                anchor.before(fragment);
                return cleanup_fn;
            }

            promise_cleanup_fn = pending_fn(fragment, ctx);

            promise.then((value) => {
                if (latest_promise_id !== current_promise_id) return;
                final_cleanup_fn = then_fn(fragment, { ...ctx, [then_key]: value });
            }).catch((error) => {
                if (latest_promise_id !== current_promise_id) return;
                if (catch_fn) final_cleanup_fn = catch_fn(fragment, { ...ctx, [catch_key]: error });
                console.error(error);
            }).finally(() => {
                if (latest_promise_id !== current_promise_id) return;
                promise_cleanup_fn();
                promise_cleanup_fn = final_cleanup_fn;
                anchor.before(fragment);
            });

            return cleanup_fn;
        });
    },
    core_component: function (anchor, fn, props) {
        const fragment = document.createDocumentFragment();
        const cleanup = fn.default(fragment, props)
        anchor.before(fragment);
        return cleanup;
    }
});

/**
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

/** @typedef {{ children : number[][], text_funcs : { child_index : number, expr : string }[], attr_funcs : { child_index : number, expr : string, property : string }[], bindings : { child_index : number, var : string, property : string, event_type : string }[], events : { child_index : number, event_type : string, expr : string }[], blocks : { child_index : number, type : string, id : string }[], core_component_blocks : { child_index : number, component_name : string, props : { [key:string] : string }, dynamicProps : { name : string, expr : string }[] } }} Processes */

/**
 * @param {Node} node
 * @param {number[]} node_index
 * @param {Processes} processes
 */
function processNode(node, node_index = [], processes = { children: [], events: [], bindings: [], attr_funcs: [], text_funcs: [], blocks: [], core_component_blocks: [] }) {
    const isStyle = node instanceof HTMLStyleElement;
    if (isStyle) return processes;

    const isText = node.nodeType === Node.TEXT_NODE;
    if (isText) {
        const expression = node.textContent;
        const parts = expression.split(/({{[^}]+}})/g);
        const has_handlebars = parts.map(p => p.startsWith("{{")).filter(p => p === true).length > 0;
        if (!has_handlebars) return processes;

        node.textContent = "";
        const expr = `\`${expression.replace(/{{\s*(.+?)\s*}}/g, (_, e) => "${" + e + "}")}\``;

        processes.children.push(node_index);
        processes.text_funcs.push({ child_index: processes.children.length - 1, expr });
        return processes;
    }

    if (node.nodeType === Node.COMMENT_NODE) return processes;

    const isCoreComponentNode = (node) => Boolean(node.dataset && node.dataset.block === "core-component");
    if (isCoreComponentNode(node)) {
        const component = node.dataset.component;
        if (!component) throw new Error("no default component found");
        const props_id = node.dataset.blockPropsId;
        processes.children.push(node_index);
        processes.core_component_blocks.push({ child_index: processes.children.length - 1, component, props_id });
        return processes;
    }

    const isBlockNode = (node) => Boolean(node.dataset && node.dataset.block && node.dataset.blockId)
    if (isBlockNode(node)) {
        processes.children.push(node_index);
        processes.blocks.push({ child_index: processes.children.length - 1, type: node.dataset.block, id: node.dataset.blockId });
        return processes;
    }

    if (node.attributes) {
        for (const attr of Array.from(node.attributes)) {
            const attrName = attr.name.toLowerCase();
            if (attrName.startsWith('bind:')) {
                const property = attrName.slice(5);
                const event_type_dic = {
                    "checked": node.type === "date" ? "change" : "click",
                    "value": node.tagName === "select" ? "change" : "input",
                };
                const event_type = event_type_dic[property] ? event_type_dic[property] : property;

                if (!processes.children.includes(node_index)) processes.children.push(node_index);
                processes.bindings.push({ child_index: processes.children.length - 1, event_type, property, var: attr.value });

                node.removeAttribute(attrName);
            } else if (attrName.startsWith('on')) {
                const match = attr.value.match(/^{{\s*(.+?)\s*}}$/);
                const expr = !match ? "" : match[1];
                const event_type = attrName.slice(2);

                if (!processes.children.includes(node_index)) processes.children.push(node_index);
                processes.events.push({ child_index: processes.children.length - 1, event_type, expr });

                node.removeAttribute(attrName);
            } else if (attr.value.includes('{{')) {
                const expr = `\`${attr.value.replace(/{{\s*(.+?)\s*}}/g, (_, e) => "${" + e + "}")}\``;
                if (!processes.children.includes(node_index)) processes.children.push(node_index);
                processes.attr_funcs.push({ child_index: processes.children.length - 1, expr, property: attrName });

                node.removeAttribute(attrName);
            }
        };
    }

    const childNodes = Array.from(node.childNodes);
    for (let i = 0; i < childNodes.length; i++) processNode(childNodes[i], [...node_index, i], processes);

    return processes;
}

export function addComponentImports(key, components) {
    $.imported_components.set(key, components);
}

export function addBlockToCache(key, block) {
    $.block_cache.set(key, block);
}

/**
 * @param {DocumentFragment | string} fragment
 */
export function compileTemplate(fragment) {
    if (typeof fragment === "string") {
        const templateEl = document.createElement("template");
        templateEl.innerHTML = fragment;
        fragment = templateEl.content;
    }

    fragment.insertBefore(new Text(""), fragment.firstChild);
    fragment.append(new Text(""));

    const processes = processNode(fragment);

    let ctxCacheIndex = -1;
    const fragment_cache_index = $.fragment_cache.length;
    $.fragment_cache.push(fragment);

    return new Function('anchor', 'ctx', `        const $ = window.__core__;
        const frag = $.fragment_cache[${fragment_cache_index}];
        const fragment = frag.cloneNode(true);

        if (!$.fn_cache.has(frag)) $.fn_cache.set(frag, {});
        const fnCache = $.fn_cache.get(frag);

        // DATA SETUP
        const ctxKeys = Object.keys(ctx);
        const ctxValues = ctxKeys.map((k) => ctx[k]);

        // CHILD SETUP
        const boundaryNodeStart = fragment.firstChild;
        const boundaryNodeEnd = fragment.lastChild;

        ${processes.children.map((child, i) => `${i === 0 ? '' : '        '}const child${i} = fragment${resolveChildNode(child.splice(0, 1), child)};`).join("\n")}

        ${(processes.text_funcs.length > 0 || processes.attr_funcs.length > 0) ? `// ONE-WAY DATA BINDING\n        const cleanup_effect = $.effect(() => {
            ${processes.text_funcs.map((func, i) => {
        ctxCacheIndex++;
        return `${i === 0 ? '' : '            '}$.set_text(child${func.child_index}, (fnCache[${ctxCacheIndex}] || (fnCache[${ctxCacheIndex}] = $.eval(\`${escapeTemplateLiteral(func.expr)}\`, ctxKeys)))(...ctxValues));`
    }).join("\n")}${processes.attr_funcs.length <= 0 ? "" : ("\n            " + processes.attr_funcs.map((attr, i) => {
        ctxCacheIndex++;
        return `${i === 0 ? '' : '            '}$.set_attr(child${attr.child_index}, (fnCache[${ctxCacheIndex}] || (fnCache[${ctxCacheIndex}] =  $.eval(\`${escapeTemplateLiteral(attr.expr)}\`, ctxKeys)))(...ctxValues), "${attr.property}");`
    }).join("\n"))}
        })` : ""}
            ${processes.bindings.length <= 0 ? '' : ("\n        // TWO-WAY DATA BINDING\n        const bind_listeners = [];\n        " + processes.bindings.map((bind, i) => {
        return `${i === 0 ? '' : '        '}child${bind.child_index}.${bind.property} = $.is_signal(ctx.${bind.var}) ? ctx.${bind.var}() : ctx.${bind.var};\n        $.delegate("${bind.event_type}", child${bind.child_index}, $.is_signal(ctx.${bind.var}) ? (event) => ctx.${bind.var}.set(event.target.${bind.property}) : (event) => ctx.${bind.var} = event.target.${bind.property})`
    }).join("\n") + "\n")}

        const cleanups = [];

        ${processes.events.length <= 0 ? '' : "// EVENT DELEGATION\n        " + processes.events.map((event, i) => {
        ctxCacheIndex++;
        return `${i === 0 ? '' : '        '}const delegate${i}_cleanup = $.delegate("${event.event_type}", child${event.child_index}, (fnCache[${ctxCacheIndex}] || (fnCache[${ctxCacheIndex}] = $.eval(\`${escapeTemplateLiteral(event.expr)}\`, ctxKeys)))(...ctxValues));\n        cleanups.push(delegate${i}_cleanup);`
    }).join("\n")}

        ${processes.blocks.length <= 0 ? '' : (processes.blocks.map((block, i) => {
        ctxCacheIndex++;
        return block.type === "if" ? `const if${i} = $.block_cache.get("${block.id}")\n        const if${i}_cleanup = $.if(child${block.child_index}, if${i}.fns, fnCache[${ctxCacheIndex}] || (fnCache[${ctxCacheIndex}] = if${i}.exprs.map((expr) => $.eval(expr, ctxKeys))), ctx, ctxValues);\n        cleanups.push(if${i}_cleanup);` :
            block.type === "each" ? `const each${i} = $.block_cache.get("${block.id}")\n        const each${i}_cleanup = $.each(child${block.child_index}, each${i}.fn, each${i}.else_fn, fnCache[${ctxCacheIndex}] || (fnCache[${ctxCacheIndex}] = $.eval(each${i}.expr, ctxKeys)), each${i}.key, each${i}.keys, each${i}.index_key, ctx, ctxValues);\n        cleanups.push(each${i}_cleanup);` :
                block.type === "await" ? `const await${i} = $.block_cache.get("${block.id}")\n        const await${i}_cleanup = $.await(child${block.child_index}, await${i}.pending_fn, await${i}.then_fn, await${i}.then_key, await${i}.catch_fn, await${i}.catch_key, fnCache[${ctxCacheIndex}] || (fnCache[${ctxCacheIndex}] = $.eval(await${i}.expr, ctxKeys)), ctx, ctxValues);\n        cleanups.push(await${i}_cleanup);` : ""
    }).join("\n"))}

        ${processes.core_component_blocks.length <= 0 ? '' : processes.core_component_blocks.map((block, i) => {
        ctxCacheIndex++;
        return `const cc${i} = $.block_cache.get("${block.props_id}");
        const cc${i}_dynamic_props = fnCache[${ctxCacheIndex}] || (fnCache[${ctxCacheIndex}] = cc${i}.dynamic_props.map((prop) => ({ key : prop.key, fn : $.eval(prop.expr, ctxKeys) })))
        const cc${i}_anchor = new Text("");
        child${block.child_index}.parentNode.replaceChild(cc${i}_anchor, child${block.child_index});

        const cc${i}_cleanup = $.effect(() => {
            for (const dynamic_prop of cc${i}_dynamic_props) cc${i}.props[dynamic_prop.key] = dynamic_prop.fn(...ctxValues);
            return $.core_component(cc${i}_anchor, ctx.${block.component}, cc${i}.props)
        })
        cleanups.push(cc${i}_cleanup);`
    })}

        anchor.append(fragment);

        return () => {
            ${(processes.text_funcs.length > 0 || processes.attr_funcs.length > 0) ? "cleanup_effect();" : ""}
            ${processes.bindings.length > 0 ? "for (const bind_listener of bind_listeners) bind_listener(); bind_listeners.length = 0;" : ""}
            ${processes.bindings.map((bind, i) => `delete fnCache[child${bind.child_index}.__bk_${i}]`).join("\n")}
            for (const cleanup of cleanups) cleanup();
            cleanups.length = 0;

            $.remove_nodes_between(boundaryNodeStart, boundaryNodeEnd);
            boundaryNodeStart.remove();
            boundaryNodeEnd.remove();
        };`)
}

function resolveChildNode(i, i_arr = []) {
    let x = `.childNodes[${i}]`;
    if (i_arr.length <= 0) return x;
    return x + resolveChildNode(i_arr.splice(0, 1), i_arr);
}

window.__core__ = $;
