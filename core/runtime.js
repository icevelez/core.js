import { escapeTemplateLiteral } from "./helper-functions.js";
import { copyContext, setNewContext } from "./internal.js";
import { createSignal, effect, isSignal, untrackedEffect } from "./reactivity.js";

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
    is_signal: isSignal,
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

        const fragment = document.createDocumentFragment(), anchor = new Text("");
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
        let is_empty_block_mounted = false, else_block_cleanup, blocks = [];

        const fragment = document.createDocumentFragment(), anchor = new Text("");
        node.parentNode.replaceChild(anchor, node);

        return effect(() => {
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
        const copiedContext = copyContext();
        const cleanup_fn = () => promise_cleanup_fn && promise_cleanup_fn();

        const fragment = document.createDocumentFragment(), anchor = new Text("");
        node.parentNode.replaceChild(anchor, node);

        let last_id = Math.random();

        return effect(() => {
            const promise = promise_fn(...ctxValues);
            const curr_id = Math.random();
            last_id = curr_id;

            if (!(promise instanceof Promise)) {
                promise_cleanup_fn = then_fn(fragment, { ...ctx, [then_key]: promise });
                anchor.before(fragment);
                return cleanup_fn;
            }

            promise_cleanup_fn = pending_fn(fragment, ctx);

            promise.then((value) => {
                if (last_id !== curr_id || !then_fn) return;
                const setPreviousContext = setNewContext(copiedContext);
                final_cleanup_fn = then_fn(fragment, { ...ctx, [then_key]: value });
                setPreviousContext()
            }).catch((error) => {
                console.trace(error);
                if (last_id !== curr_id || !catch_fn) return;
                const setPreviousContext = setNewContext(copiedContext);
                final_cleanup_fn = catch_fn(fragment, { ...ctx, [catch_key]: error });
                setPreviousContext();
            }).finally(() => {
                if (last_id !== curr_id) return;
                promise_cleanup_fn();
                promise_cleanup_fn = final_cleanup_fn;
                anchor.before(fragment);
            });

            return cleanup_fn;
        });
    },
    core_component: function (anchor, fn, props) {
        const fragment = document.createDocumentFragment();
        const cleanup = fn.default ? fn.default(fragment, props) : fn(fragment, props);
        anchor.before(fragment);
        return cleanup;
    }
});

/**
 * @param {WeakMap<Node, Set<Function>>} map
 * @param {Event} event
 * @param {Node} target
 */
function match_delegated_node(map, event, target) {
    const fns = map.get(target);
    if (!fns) return target.parentNode ? match_delegated_node(map, event, target.parentNode) : undefined;
    for (const fn of fns) fn(event);
}

/** @typedef {{ children : number[][], text_funcs : { child_index : number, expr : string }[], attr_funcs : { child_index : number, expr : string, property : string }[], bindings : { child_index : number, var : string, property : string, event_type : string }[], events : { child_index : number, event_type : string, expr : string }[], blocks : { child_index : number, type : string, id : string }[], core_component_blocks : { child_index : number, component_name : string, props_id : string }, component_blocks : { child_index : number, component_id : number, component_tag : string, props_id : string } }} Processes */

/**
 * @param {Node} node
 * @param {number[]} node_index
 * @param {Processes} processes
 */
function processNode(node, node_index = [], processes = { children: [], events: [], bindings: [], attr_funcs: [], text_funcs: [], blocks: [], core_component_blocks: [], component_blocks: [] }) {
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

    const isComponentNode = (node) => Boolean(node.dataset && node.dataset.block === "component");
    if (isComponentNode(node)) {
        const component_id = node.dataset.componentId;
        const component_tag = node.dataset.componentTag;
        if (!component_id || !component_tag) throw new Error("component not found");
        const props_id = node.dataset.blockPropsId;
        processes.children.push(node_index);
        processes.component_blocks.push({ child_index: processes.children.length - 1, component_id, component_tag, props_id });
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

function resolveChildNode(i, i_arr = []) {
    let x = `.childNodes[${i}]`;
    if (i_arr.length <= 0) return x;
    return x + resolveChildNode(i_arr.splice(0, 1), i_arr);
}

export const addComponentImports = (key, components) => $.imported_components.set(key, components);
export const addBlockToCache = (key, block) => $.block_cache.set(key, block);

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

    let ctxI = -1;
    const fragment_cache_index = $.fragment_cache.length;
    $.fragment_cache.push(fragment);

    const func = new Function('anchor', 'ctx', `\t\tconst $ = window.__core__;
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

        ${processes.children.map((child, i) => `${i === 0 ? '' : '\t\t'}const child${i} = fragment${resolveChildNode(child.splice(0, 1), child)};`).join("\n")}

        ${(processes.text_funcs.length > 0 || processes.attr_funcs.length > 0) ? `// ONE-WAY DATA BINDING\n\t\tconst cleanup_effect = $.effect(() => {
            ${processes.text_funcs.map((func, i) => {
        ctxI++;
        return `${i === 0 ? '' : '\t\t'}$.set_text(child${func.child_index}, (fnCache[${ctxI}] || (fnCache[${ctxI}] = $.eval(\`${escapeTemplateLiteral(func.expr)}\`, ctxKeys)))(...ctxValues));`
    }).join("\n")}${processes.attr_funcs.length <= 0 ? "" : ("\n            " + processes.attr_funcs.map((attr, i) => {
        ctxI++;
        return `${i === 0 ? '' : '\t\t'}$.set_attr(child${attr.child_index}, (fnCache[${ctxI}] || (fnCache[${ctxI}] =  $.eval(\`${escapeTemplateLiteral(attr.expr)}\`, ctxKeys)))(...ctxValues), "${attr.property}");`
    }).join("\n"))}
        })` : ""}
        const cleanups = [];
            ${processes.bindings.length <= 0 ? '' : ("\n\t\t// TWO-WAY DATA BINDING\n\t\t" + processes.bindings.map((bind, i) => {
        return `${i === 0 ? '' : '\t\t'}const bind${i}_cleanup = $.effect(() => child${bind.child_index}.${bind.property} = (fnCache[${++ctxI}] || (fnCache[${ctxI}] = $.eval("window.__core__.is_signal(${bind.var}) ? ${bind.var}() : ${bind.var}", ctxKeys)))(...ctxValues));\n        cleanups.push(bind${i}_cleanup);\n        const bind${i}_delegate_cleanup = $.delegate("${bind.event_type}", child${bind.child_index}, fnCache[${++ctxI}] || (fnCache[${ctxI}] = $.eval("(event) => window.__core__.is_signal(${bind.var}) ? ${bind.var}.set(event.target.${bind.property}) : (${bind.var} = event.target.${bind.property})", ctxKeys)(...ctxValues)))\n        cleanups.push(bind${i}_delegate_cleanup);`
    }).join("\n") + "\n")}
        ${processes.events.length <= 0 ? '' : "// EVENT DELEGATION\n        " + processes.events.map((event, i) => {
        ctxI++;
        return `${i === 0 ? '' : '\t\t'}const delegate${i}_cleanup = $.delegate("${event.event_type}", child${event.child_index}, (fnCache[${ctxI}] || (fnCache[${ctxI}] = $.eval(\`${escapeTemplateLiteral(event.expr)}\`, ctxKeys)))(...ctxValues));\n        cleanups.push(delegate${i}_cleanup);`
    }).join("\n")}

        ${processes.blocks.length <= 0 ? '' : (processes.blocks.map((block, i) => {
        ctxI++;
        return block.type === "if" ? `const if${i} = $.block_cache.get("${block.id}")\n\t\tconst if${i}_cleanup = $.if(child${block.child_index}, if${i}.fns, fnCache[${ctxI}] || (fnCache[${ctxI}] = if${i}.exprs.map((expr) => $.eval(expr, ctxKeys))), ctx, ctxValues);\n        cleanups.push(if${i}_cleanup);` :
            block.type === "each" ? `const each${i} = $.block_cache.get("${block.id}")\n\t\tconst each${i}_cleanup = $.each(child${block.child_index}, each${i}.fn, each${i}.else_fn, fnCache[${ctxI}] || (fnCache[${ctxI}] = $.eval(each${i}.expr, ctxKeys)), each${i}.key, each${i}.keys, each${i}.index_key, ctx, ctxValues);\n        cleanups.push(each${i}_cleanup);` :
                block.type === "await" ? `const await${i} = $.block_cache.get("${block.id}")\n\t\tconst await${i}_cleanup = $.await(child${block.child_index}, await${i}.pending_fn, await${i}.then_fn, await${i}.then_key, await${i}.catch_fn, await${i}.catch_key, fnCache[${ctxI}] || (fnCache[${ctxI}] = $.eval(await${i}.expr, ctxKeys)), ctx, ctxValues);\n        cleanups.push(await${i}_cleanup);` : ""
    }).join("\n"))}

        ${processes.core_component_blocks.length <= 0 ? '' : processes.core_component_blocks.map((block, i) => {
        ctxI++;
        return `const cc${i} = $.block_cache.get("${block.props_id}");
        const cc${i}_dynamic_props = fnCache[${ctxI}] || (fnCache[${ctxI}] = cc${i}.dynamic_props.map((prop) => ({ key : prop.key, fn : $.eval(prop.expr, ctxKeys) })))
        const cc${i}_anchor = new Text("");
        child${block.child_index}.parentNode.replaceChild(cc${i}_anchor, child${block.child_index});

        const cc${i}_cleanup = $.effect(() => {
            for (const dynamic_prop of cc${i}_dynamic_props) cc${i}.props[dynamic_prop.key] = dynamic_prop.fn(...ctxValues);
            return $.core_component(cc${i}_anchor, ctx.${block.component}, cc${i}.props)
        })
        cleanups.push(cc${i}_cleanup);`
    }).join("\n")}
        ${processes.component_blocks.length <= 0 ? '' : processes.component_blocks.map((block, i) => {
        ctxI++;
        return `const comp${i} = $.block_cache.get("${block.props_id}");
        const comp${i}_cache = $.imported_components.get("${block.component_id}");
        const comp${i}_dynamic_props = fnCache[${ctxI}] || (fnCache[${ctxI}] = comp${i}.dynamic_props.map((prop) => ({ key : prop.key, fn : $.eval(prop.expr, ctxKeys) })))
        const comp${i}_anchor = new Text("");
        child${block.child_index}.parentNode.replaceChild(comp${i}_anchor, child${block.child_index});

        const comp${i}_cleanup = $.effect(() => {
            for (const dynamic_prop of comp${i}_dynamic_props) comp${i}.props[dynamic_prop.key] = dynamic_prop.fn(...ctxValues);
            return $.core_component(comp${i}_anchor, comp${i}_cache.${block.component_tag}, comp${i}.props)
        })
        cleanups.push(comp${i}_cleanup);`
    }).join("\n")}

        anchor.append(fragment);

        return () => {
            ${(processes.text_funcs.length > 0 || processes.attr_funcs.length > 0) ? "cleanup_effect();" : ""}
            for (const cleanup of cleanups) cleanup();
            cleanups.length = 0;

            $.remove_nodes_between(boundaryNodeStart, boundaryNodeEnd);
            boundaryNodeStart.remove();
            boundaryNodeEnd.remove();
        };`)

    return func;
}

window.__core__ = $;
