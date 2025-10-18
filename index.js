// import { mount } from "./core/core.js";
// import App from "./src/App.js";

// mount(App, { target: document.getElementById("app") });

import { makeId } from "./core/helper-functions.js";
import { coreEventListener } from "./core/handlebar.js";
import { createDerived, createSignal, effect } from "./core/reactivity.js";

function resolveChildNode(i, more_levels = []) {
    let x = `.children[${i}]`;
    if (more_levels.length <= 0) return x;
    return x + resolveChildNode(more_levels.splice(0, 1), more_levels);
}

const fragment_cache = [];

window.compileEffectCounter = 0;

function compileTemplate(fragment, processes) {
    let ctxCacheIndex = -1;
    const fragment_cache_index = fragment_cache.length;
    fragment_cache.push(fragment);

    window.compileEffectCounter++;

    return new Function('anchor', 'ctx', '$', `
        const frag = $.fragment_cache[${fragment_cache_index}];
        const fragment = frag.cloneNode(true);

        const boundaryNodeStart = new Text("");
        const boundaryNodeEnd = new Text("");

        fragment.insertBefore(boundaryNodeStart, fragment.firstChild)
        fragment.append(boundaryNodeEnd)

        // CONTEXT DATA SETUP
        const ctxKeys = Object.keys(ctx);
        const ctxValues = ctxKeys.map((k) => ctx[k]);

        let ctxCache = $.ctx_cache.get(frag);
        if (!ctxCache) {
            ctxCache = {};
            $.ctx_cache.set(frag, ctxCache);
        }

        // CHILD SETUP
        ${processes.children.map((child, i) => `${i === 0 ? '' : '        '}const child_${i} = fragment${resolveChildNode(i, child.level)};`).join("\n")}

        // ONE-WAY BINDING
        ${processes.text_funcs.map((func, i) => {
        ctxCacheIndex++;
        return `${i === 0 ? '' : '        '}const text_func_${i} = ctxCache[${ctxCacheIndex}] ? ctxCache[${ctxCacheIndex}] : ctxCache[${ctxCacheIndex}] = $.eval(${func.expr}, ctxKeys);`;
    }).join("\n")}
        ${processes.attr_funcs.map((attr, i) => {
        ctxCacheIndex++;
        return `${i === 0 ? '' : '        '}const attr_func_${i} = ctxCache[${ctxCacheIndex}] ? ctxCache[${ctxCacheIndex}] : ctxCache[${ctxCacheIndex}] =  $.eval(${func.expr}, ctxKeys);`;
    }).join("\n")}
        let cleanup;

        ${(processes.text_funcs.length > 0 || processes.attr_funcs.length > 0) ? `cleanup = $.effect(() => {
            ${processes.text_funcs.map((func, i) => `${i === 0 ? '' : '            '}$.set_text(child_${func.child_index}, text_func_${i}(...ctxValues));`).join("\n")}
            ${processes.attr_funcs.map((attr, i) => `${i === 0 ? '' : '            '}$.set_attr(child_${attr.child_index}, attr_func_${i}(...ctxValues), ${attr.property});`).join("\n")}
        })` : ""}

        // TWO-WAY BINDING
        ${processes.bindings.map((bind, i) => {
        const key = `"${fragment_cache_index}:${bind.property}:${bind.var}"`;
        return `const bind_${i} = ctxCache[${key}] ? ctxCache[${key}] : ctxCache[${key}] = $.is_signal(ctx.${bind.var}) ?
                (ctx.${bind.var}[$.is_signal_read_only] ? () => { throw new Error('signal is read-only') } : (event) => ctx.${bind.var}.set(event.target.${bind.property})) :
                (event) => ctx.${bind.var} = event.target.${bind.property};
        $.bind("${bind.event_type}", child_${bind.child_index}, bind_${i});`
    }).join("\n")}

        // EVENT DELEGATION
        ${processes.events.map((event, i) => {
        ctxCacheIndex++;
        return `const event_func_${i} = ctxCache[${ctxCacheIndex}] ? ctxCache[${ctxCacheIndex}] : ctxCache[${ctxCacheIndex}] = $.eval(${event.expr}, ctxKeys);
        $.delegate("${event.event_type}", child_${event.child_index}, event_func_${i}(...ctxValues));`
    }).join("\n")}

        anchor.append(fragment);

        return () => {
            $.remove_nodes_between(boundaryNodeStart, boundaryNodeEnd);
            boundaryNodeStart.remove();
            boundaryNodeEnd.remove();
            if (cleanup) cleanup();
        }
    `)
}

const tp = compileTemplate(Object.assign(document.createElement("template"), {
    innerHTML: `<h1></h1>
    <div>
        <label>Type new name</label>
        <input type="text"/>
    </div>
    <p></p>
    <p></p>
    <p></p>
    <button>Click Me!</button>
`
}).content, {
    children: [
        { level: [] },
        { level: [1] },
        { level: [] },
        { level: [] },
        { level: [] },
        { level: [] },
    ],
    text_funcs: [
        { child_index: 0, expr: "\"\`Hello ${ name() }!\`\"" },
        { child_index: 2, expr: "\"\`Counter: ${ counter() }\`\"" },
        { child_index: 3, expr: "\"\`Double: ${ double() }\`\"" },
        { child_index: 4, expr: "\"\`Double is even: ${ double() % 2 === 0 }\`\"" },
    ],
    attr_funcs: [],
    events: [
        { child_index: 5, event_type: 'click', expr: '"() => counter.set(counter() + 1)"' }
    ],
    bindings: [
        // { child_index: 1, event_type: 'input', property: 'value', var: 'name' }
    ],
});

const core = {
    fragment_cache,
    ctx_cache: new WeakMap(),
    eval: function (expr, keys) {
        return new Function(...keys, `try { return ${expr}; } catch (error) { console.error(error); return undefined; }`);
    },
    set_text: function (node, text) {
        // if (node.__cacheText === text) return;
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

console.log(tp);

const app = document.getElementById("app");
const data = [];
let cleanups = [];

console.time();
for (let i = 0; i < 10_000; i++) {
    const counter = createSignal(i);
    const ctx = {
        name: createSignal(makeId(8)),
        counter,
        double: createDerived(() => counter() * 2)
    }
    data.push(ctx);
    cleanups.push(tp(app, ctx, core));
}
console.timeEnd();


setTimeout(() => {
    for (let i = 0; i < data.length; i++) {
        data[i].counter.set(data[i].counter() + 1);
        data[i].name.set(makeId(8));
    }
    setTimeout(() => {
        cleanups.map((cleanup) => cleanup());
        cleanups = [];
    }, 2000);
}, 2000);
