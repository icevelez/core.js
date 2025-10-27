
import { makeId } from "../core/helper-functions.js";
import { coreEventListener } from "../core/handlebar.js";
import { createDerived, createSignal, effect } from "../core/reactivity.js";

/** @type {DocumentFragment[]} */
const fragment_cache = [];

function resolveChildNode(i, more_levels = []) {
    let x = `.childNodes[${i}]`;
    if (more_levels.length <= 0) return x;
    return x + resolveChildNode(more_levels.splice(0, 1), more_levels);
}

/**
 * @typedef {{ children : number[][], text_funcs : { child_index : number, expr : string }[], attr_funcs : { child_index : number, expr : string, property : string }[], bindings : { child_index : number, var : string, property : string, event_type : string }[], events : { child_index : number, event_type : string, expr : string }[] }} Processes
 */

/**
 *
 * @param {DocumentFragment} fragment
 * @returns {Processes}
 */
function analyzeTemplate(fragment) {
    /** @type {Processes} */
    const processes = {
        children: [],
        events: [],
        bindings: [],
        attr_funcs: [],
        text_funcs: [],
    };

    // SETUP TEMPLATE BOUNDARY
    fragment.insertBefore(new Text(""), fragment.firstChild);
    fragment.append(new Text(""));

    /**
     * @param {Node} node
     */
    function processNode(node, node_index = []) {
        const isStyle = node instanceof HTMLStyleElement;
        if (isStyle) return;

        const isText = node.nodeType === Node.TEXT_NODE;
        if (isText) {
            const expression = node.textContent;
            node.textContent = "";

            const parts = expression.split(/({{[^}]+}})/g);
            const has_handlebars = parts.map(p => p.startsWith("{{")).filter(p => p === true).length > 0;
            if (!has_handlebars) return;

            const expr = `"\`${expression.replace(/{{\s*(.+?)\s*}}/g, (_, e) => "${" + e + "}")}\`"`;

            processes.children.push(node_index);
            processes.text_funcs.push({ child_index: processes.children.length - 1, expr });
            return;
        }

        if (node.nodeType === Node.COMMENT_NODE) return;

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
        for (let i = 0; i < childNodes.length; i++) {
            processNode(childNodes[i], [...node_index, i]);
        }
    }

    processNode(fragment);

    return processes;
}

/**
 *
 * @param {DocumentFragment} fragment
 * @param {Processes} processes
 */
function compileTemplate(fragment, processes) {
    let ctxCacheIndex = -1;
    const fragment_cache_index = fragment_cache.length;
    fragment_cache.push(fragment);

    return new Function('ctx', '$', `        const frag = $.fragment_cache[${fragment_cache_index}];
        const fragment = frag.cloneNode(true);

        // DATA SETUP
        const ctxKeys = Object.keys(ctx);
        const ctxValues = ctxKeys.map((k) => ctx[k]);

        if (!$.ctx_cache.has(frag)) $.ctx_cache.set(frag, {});
        const ctxCache = $.ctx_cache.get(frag);

        // CHILD SETUP
        const boundaryNodeStart = fragment.firstChild;
        const boundaryNodeEnd = fragment.lastChild;

        ${processes.children.map((child, i) => `${i === 0 ? '' : '        '}const child_${i} = fragment${resolveChildNode(child.splice(0, 1), child)};`).join("\n")}

        ${(processes.text_funcs.length > 0 || processes.attr_funcs.length > 0) ? `// ONE-WAY DATA BINDING\n        const cleanup = $.effect(() => {
            ${processes.text_funcs.map((func, i) => {
        ctxCacheIndex++;
        return `${i === 0 ? '' : '            '}$.set_text(child_${func.child_index}, (ctxCache[${ctxCacheIndex}] ? ctxCache[${ctxCacheIndex}] : ctxCache[${ctxCacheIndex}] = $.eval(${func.expr}, ctxKeys))(...ctxValues));`
    }).join("\n")}${processes.attr_funcs.length <= 0 ? "" : processes.attr_funcs.map((attr, i) => {
        ctxCacheIndex++;
        return `${i === 0 ? '' : '            '}$.set_attr(child_${attr.child_index}, (ctxCache[${ctxCacheIndex}] ? ctxCache[${ctxCacheIndex}] : ctxCache[${ctxCacheIndex}] =  $.eval(${attr.expr}, ctxKeys))(...ctxValues), ${attr.property});`
    }).join("\n")}
        })` : ""}
            ${processes.bindings.length <= 0 ? '' : ("\n// TWO-WAY DATA BINDING\n        " + processes.bindings.map((bind, i) => {
        const key = `"${fragment_cache_index}:${bind.property}:${bind.var}"`;
        return `const bind_${i} = ctxCache[${key}] ? ctxCache[${key}] : ctxCache[${key}] = $.is_signal(ctx.${bind.var}) ?
                    (ctx.${bind.var}[$.is_signal_read_only] ? () => { throw new Error('signal is read-only') } : (event) => ctx.${bind.var}.set(event.target.${bind.property})) :
                    (event) => ctx.${bind.var} = event.target.${bind.property};
            $.bind("${bind.event_type}", child_${bind.child_index}, bind_${i});`
    }).join("\n") + "\n")}
        ${processes.events.length <= 0 ? '' : "// EVENT DELEGATION\n        " + processes.events.map((event, i) => {
        ctxCacheIndex++;
        return `${i === 0 ? '' : '        '}$.delegate("${event.event_type}", child_${event.child_index}, (ctxCache[${ctxCacheIndex}] ? ctxCache[${ctxCacheIndex}] : ctxCache[${ctxCacheIndex}] = $.eval(${event.expr}, ctxKeys))(...ctxValues));`
    }).join("\n")}

        return {
            mount: (anchor) => anchor.append(fragment),
            unmount: () => {
                $.remove_nodes_between(boundaryNodeStart, boundaryNodeEnd);
                boundaryNodeStart.remove();
                boundaryNodeEnd.remove();
            }
        };`)
}

const core = {
    fragment_cache,
    /** @type {WeakMap<DocumentFragment, []>} */
    ctx_cache: new WeakMap(),
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
    bind: function (event_type, node, bind_func) {
        node.addEventListener(event_type, bind_func);
    },
    delegate: coreEventListener.add,
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
    }
};

const template = document.createElement("template");
template.innerHTML = `
    <div style="display: flex; gap: 1rem;">
        <p class="col-md-1">{{row().id}}</p>
    	<p class="col-md-4">
    		<a onclick="{{ () => selected() = row().id }}">{{ i()+1 }} {{row().label}}</a>
    	</p>
    	<p class="col-md-1">
    	    <a onclick="{{() => remove(row())}}">
    		    Delete
    		</a>
    	</p>
    	<p class="col-md-6"></p>
    </div>
`;

const template_bindings = analyzeTemplate(template.content);
const template_function = compileTemplate(template.content, template_bindings);

console.log(template_function);

const app = document.getElementById("app");
const templateFrag = document.createElement("template");

const data = [];
let cleanups = [];

const selected = createSignal("");

function remove(item) { }

window.clean = () => {
    cleanups.forEach((cleanup) => cleanup());
    cleanups = [];
}

window.run = () => {
    app.innerHTML = "";
    setTimeout(() => {

        console.time();
        for (let i = 0; i < 10_000; i++) {
            data[i] = {
                i: () => i,
                selected,
                row: createSignal({
                    id: i + 1,
                    label: makeId(8),
                }),
                remove,
            }
            const block = template_function(data[i], core)
            block.mount(templateFrag.content);
        }
        app.appendChild(templateFrag.content);
        requestAnimationFrame(() => {
            console.timeEnd();
        })
    })
}

window.rerun = () => {
    console.time();
    for (let i = 0; i < 10_000; i++) {
        data[i].row().id += 10_000;
        data[i].row().label = makeId(8);
    }
    requestAnimationFrame(() => {
        console.timeEnd();
    })
}

window.run();
setTimeout(() => {
    window.run();
    setTimeout(() => {
        window.run();
        setTimeout(() => {
            window.run();
            setTimeout(() => {
                window.run();
                setTimeout(() => {
                    window.run();
                }, 700)
            }, 700)
        }, 700)
    }, 700)
}, 700)
