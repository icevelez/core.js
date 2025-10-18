import { core_context, onMountQueue, onUnmountQueue, runScopedMountUnmount, copyContextQueue, setContextQueue, pushNewContext } from "./core-internal.js";
import { effect, untrackedEffect, isSignal, makeFuncSignal, createSignal } from "./reactivity.js";
import { createStartEndNode, makeId, removeNodesBetween, parseOuterBlocks, isObject } from "./helper-functions.js";
import { onMount } from "./core.js";

const dev_mode_on = true;

/** @type {Map<string, Function>} */
const evaluationCache = new Map();

/** @type {Map<string, WeakMap<Node, Set<Function>>>} */
const delegated_events = new Map();

/** @type {Map<string, DocumentFragment>} */
const slotCache = new Map();

/** @type {Map<string, (startNode:Node, endNode:Node, ctx:any) => void>} */
const markedNodeCache = new Map();

/** @type {Map<number, Record<string, Function>>} */
const imported_components = new Map();

/** @type {WeakMap<Node, Record<string, any>[]>} */
const cacheNodeProcesses = new WeakMap();

/** @type {WeakMap<any, Function | Function[]>} */
const cacheAppliedProcesses = new WeakMap();

if (dev_mode_on) window.__corejs__ = {
    evaluationCache,
    markedNodeCache,
    slotCache,
    imported_components,
    cacheNodeProcesses,
    cacheAppliedProcesses,
    delegated_events,
}

/**
* @param {{ template : string, components : Record<string, Function> }} options
* @param {Object} Model anonymous class that encapsulate data and logic
* @returns {(props:Record<string, any>, render_slot_callbackfn:() => DocumentFragment) => DocumentFragment}
*/
export function component(options, Model = class { }) {
    if (Model && !Model.toString().startsWith("class")) throw new Error("context is not a class");

    const components_id = makeId(6);

    let template = processComponents(options.template, components_id);
    if (options.components && Object.keys(options.components).length > 0) imported_components.set(components_id, options.components);

    const fragment = createNodes(parseTemplate(template));

    return function (props, render_slot_callbackfn) {
        const current_context = pushNewContext();
        let resetContext;

        onMount(() => resetContext = setContextQueue(current_context));

        const ctx = !Model ? {} : new Model(props);
        const processed_fragment = createFragment(fragment, ctx, render_slot_callbackfn);

        onMount(() => resetContext());

        return processed_fragment;
    }
}

/**
* @param {string} template
*/
function createNodes(template) {
    if (typeof template !== "string") throw new Error("template is not a string");
    if (template == "") return document.createDocumentFragment();

    const templateElement = document.createElement("template");
    templateElement.innerHTML = template;

    for (const childNode of Array.from(templateElement.content.childNodes)) preprocessTextNodes(childNode);

    const fragment = templateElement.content;
    const processes = preprocessNode(fragment);
    if (processes.length <= 0) return fragment;

    cacheNodeProcesses.set(fragment, processes);

    return fragment;
}

/**
* @param {DocumentFragment} fragment
* @param {Record<string, any>} ctx
* @param {Function} render_slot_callbackfn
*/
function createFragment(fragment, ctx, render_slot_callbackfn) {
    const clone_fragment = fragment.cloneNode(true);
    const processes = cacheNodeProcesses.get(fragment);
    if (!processes) return clone_fragment;
    return applyProcess(clone_fragment, processes, ctx, render_slot_callbackfn);
}

const eachRegex = /{{#each\s+(.+?)\s+as\s+((?:\w+|\{[\s\S]*?\}|\([\s\S]*?\)))\s*(?:,\s*(\w+))?}}([\s\S]*?){{\/each}}/g;

/**
* @param {string} eachBlock
*/
function parseEach(eachBlock) {
    let eachConfig = {
        expression: "",
        /** @type {DocumentFragment} */
        mainContent: null,
        /** @type {DocumentFragment} */
        emptyContent: null,
        /** @type {string[]} */
        blockVars: [],
        blockVar: "",
        indexVar: ""
    }

    eachBlock.replace(eachRegex,
        /**
         * @param {any} _
         * @param {string} expression
         * @param {string} blockVar
         * @param {string} indexVar
         * @param {string} content
         */
        function (_, expression, blockVar, indexVar, content) {
            const [mainContent, emptyContent] = content.split(/{{:empty}}/);
            eachConfig = { expression, blockVars: [], blockVar, indexVar, mainContent: createNodes(mainContent), emptyContent: createNodes(emptyContent || "") };
        }
    );

    const blockvar = eachConfig.blockVar.trim();
    if (blockvar.startsWith("{")) eachConfig.blockVars = blockvar.replace("{", "").replace("}", "").trim().split(",").map(v => v.trim());

    return eachConfig;
}

const ifRegex = /{{#if\s+(.+?)}}([\s\S]*?){{\/if}}/g;
const ifElseregex = /{{:else\s+if\s+(.+?)}}|{{:else}}/g;

/**
* @param {string} ifBlock
*/
function parseIf(ifBlock) {
    /** @type {{ block : DocumentFragment, condition : string }[]} */
    const segments = [];

    ifBlock.replace(ifRegex,
        /**
         * @param {string} _
         * @param {string} firstCondition
         * @param {string} firstBlock
         */
        function (_, firstCondition, firstBlock) {
            let lastIndex = 0, match;

            while ((match = ifElseregex.exec(firstBlock)) !== null) {
                if (match.index > lastIndex) {
                    segments.push({
                        condition: firstCondition,
                        block: createNodes(firstBlock.substring(lastIndex, match.index))
                    });
                }

                if (match[0].startsWith('{{:else if')) {
                    firstCondition = match[1];
                    lastIndex = match.index + match[0].length;
                } else if (match[0] === '{{:else}}') {
                    segments.push({
                        condition: 'true', // Always true for else
                        block: createNodes(firstBlock.substring(match.index + match[0].length))
                    });
                    lastIndex = firstBlock.length; // Done
                }
            }

            if (lastIndex < firstBlock.length) segments.push({
                condition: firstCondition,
                block: createNodes(firstBlock.substring(lastIndex))
            });
        }
    );

    return segments;
}

const awaitRegex = /{{#await\s+(.+?)}}([\s\S]*?){{\/await}}/g;
const thenRegex = /\{\{:then(?:\s+(\w+))?\}\}(.*?)(?={{:|$)/s;
const catchRegex = /\{\{:catch(?:\s+(\w+))?\}\}(.*?)(?={{:|$)/s;
const blockRegex = /{{:then[\s\S]*?}}|{{catch[\s\S]*?}}/;

/**
* @param {string} awaitBlock
*/
function parseAwait(awaitBlock) {
    const awaitConfig = {
        promiseExpr: "",
        /** @type {DocumentFragment} */
        pendingContent: null,
        then: {
            match: false,
            var: null,
            expr: "",
            /** @type {DocumentFragment} */
            content: null,
        },
        catch: {
            match: false,
            var: null,
            expr: "",
            /** @type {DocumentFragment} */
            content: null,
        },
    }

    awaitBlock.replace(awaitRegex,
        /**
         * @param {string} _
         * @param {string} promiseExpr
         * @param {string} block
         */
        function (_, promiseExpr, block) {
            awaitConfig.promiseExpr = promiseExpr;

            const thenMatch = block.match(thenRegex);
            if (thenMatch) {
                const [_, thenVar, thenContent] = thenMatch;
                awaitConfig.then = { match: true, var: thenVar, content: createNodes(thenContent || "") };
            }

            const catchMatch = block.match(catchRegex);
            if (catchMatch) {
                const [_, catchVar, catchContent] = catchMatch;
                awaitConfig.catch = { match: true, var: catchVar, content: createNodes(catchContent || "") };
            }

            const pendingContent = block.split(blockRegex)[0] || '';
            awaitConfig.pendingContent = createNodes(pendingContent);
        }
    );

    return awaitConfig;
}

/**
* Replaces handlebar directive like `{{#if}}` or `{{#each}}` with a placeholder element and processed by a custom function
* @param {string} template
*/
function parseTemplate(template) {
    template = processDirectiveBlocks(template, "await", parseAwait);
    template = processDirectiveBlocks(template, "if", parseIf);
    template = processDirectiveBlocks(template, "each", parseEach);
    return template;
}

/**
* Indirect recursive function to process handlebar directive, replacing it with a placeholder `<template>` element
* then process the contents of each directive block with its respective processor function and cached to be used upon rendering
* @param {string} template
* @param {string} directive
* @param {Function} processBlocks
*/
function processDirectiveBlocks(template, directive, processBlocks) {

    const openTag = `{{#${directive}`;
    const closeTag = `{{/${directive}}}`;
    const blocks = parseOuterBlocks(template, openTag, closeTag);

    for (const i in blocks) {
        const marker_id = `${directive}-${makeId(8)}`;

        template = template.replace(blocks[i], `<template data-directive="${directive}" data-marker-id="${marker_id}"></template>`)

        const start = blocks[i].match(new RegExp(`\\{\\{#${directive}\\s+(.*?)\\}\\}`))[0];
        const end = blocks[i].lastIndexOf(`{{/${directive}}}`);
        const block = blocks[i].slice(0, end).replace(start, "");

        blocks[i] = start + parseTemplate(block) + `{{/${directive}}}`;

        markedNodeCache.set(marker_id, processBlocks(blocks[i]));
    }

    return template;
}

/**
* Replaces all custom HTML Tags with capital first letter with a placeholder element to be replaced later
* @param {string} template
* @param {number} imported_component_id
*/
function processComponents(template, imported_component_id) {
    const componentRegex = /<([A-Z][A-Za-z0-9]*)\s*((?:[^>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>(?:([\s\S]*?)<\/\1>)?/g;
    const directive = "component";

    template = template.replace(componentRegex, (match, tag, attrStr, _, slot_content) => {
        if (match.startsWith("<Core:slot")) return `<template data-directive="slot"></template>`;
        if (match.startsWith("<Core:component")) {
            if (!slot_content) return `<template data-directive="core-component" ${attrStr.slice(10)}></template>`;
            const slot_id = `slot-${makeId(6)}`;
            slotCache.set(slot_id, createNodes(slot_content || ""))
            return `<template data-directive="core-component" data-slot-id="${slot_id}" ${attrStr.slice(10)}></template>`;
        }

        const marker_id = `${directive}-${makeId(8)}`;
        const component = { import_id: imported_component_id, tag, attrStr, slot_node: createNodes(slot_content || "") || [] };
        markedNodeCache.set(marker_id, component);

        return `<template data-import-id="${imported_component_id}" data-directive="${directive}" data-marker-id="${marker_id}"></template>`;
    })

    return template;
}

/**
* The purpose of this function is to search for text and split them into individual text nodes for finer text interpolation
* @param {Node} node
*/
function preprocessTextNodes(node) {
    const isText = node.nodeType === Node.TEXT_NODE;
    if (!isText) {
        const childNodes = Array.from(node.childNodes);
        for (const child_node of childNodes) preprocessTextNodes(child_node);
        return;
    }

    const expression = node.textContent;
    const parts = expression.split(/({{[^}]+}})/g);
    if (parts.length <= 1) return;

    const has_handlebars = parts.map(p => p.startsWith("{{")).filter(p => p === true).length > 0;
    if (!has_handlebars) return;

    node.textContent = "";
    const parent = node.parentNode;

    for (const part of parts) {
        const textNode = document.createTextNode("");
        textNode.textContent = part;
        parent.insertBefore(textNode, node);
    };

    node.remove();
}

const process_type_enum = {
    "textInterpolation": 1,
    "attributeInterpolation": 2,
    "slotInjection": 3,
    "coreComponent": 4,
    "markedBlocks": 5,
    "directiveBind": 6,
    "directiveUse": 7,
    "eventListener": 8,
    "children": 9,
};

/**
* The purpose of this function is to search the dynamic bindings of a node and its children (recursively)
* and caching those bindings to be used when rendering to the DOM, skipping static nodes and attributes
* @param {Node} node
*/
function preprocessNode(node) {
    /** @type {Record<string, any>[]} */
    const processes = [];

    const isStyle = node instanceof HTMLStyleElement;
    if (isStyle) return processes;

    const isText = node.nodeType === Node.TEXT_NODE;
    if (isText) {
        const expression = node.textContent;
        const parts = expression.split(/({{[^}]+}})/g);
        const has_handlebars = parts.map(p => p.startsWith("{{")).filter(p => p === true).length > 0;
        if (!has_handlebars) return processes;

        node.textContent = "";

        let match, expr;
        expression.replace(/{{\s*([^#\/][^}]*)\s*}}/g, (m, e) => { match = m; expr = e; });
        processes.push({ type: process_type_enum.textInterpolation, match, expr, full_expr: expression });
        return processes;
    }

    if (node.nodeType === Node.COMMENT_NODE) return processes;

    const isSlotNode = (node) => Boolean(node.dataset && node.dataset.directive === "slot");
    const isCoreComponentNode = (node) => Boolean(node.dataset && node.dataset.directive === "core-component");
    const isMarkedNode = (node) => Boolean(node.dataset && node.dataset.directive && node.dataset.markerId)

    if (isSlotNode(node)) {
        processes.push({ type: process_type_enum.slotInjection });
        return processes;
    }

    if (isCoreComponentNode(node)) {
        const component_name = node.getAttribute("default");
        const attrs = [...node.attributes], props = {}, dynamicProps = [];
        const slot_id = node.dataset.slotId;
        const slot_nodes = slot_id ? slotCache.get(slot_id) : null;

        for (const attr of attrs) {
            node.removeAttribute(attr.name);
            if (attr.value.startsWith("{{")) {
                dynamicProps.push({ name: attr.name, value: attr.value });
                continue;
            }
            props[attr.name] = attr.value;
        }

        processes.push({ type: process_type_enum.coreComponent, slot_nodes, component_name, props, dynamicProps });
        return processes;
    }

    if (isMarkedNode(node)) {
        const marker_type = node.dataset.directive;
        const marker_id = node.dataset.markerId;
        const payload = markedNodeCache.get(marker_id);
        if (!payload) throw new Error(`processed template type "${process_type}" with marker id "${marker_id}" does not exists`);
        processes.push({ type: process_type_enum.markedBlocks, marker_type, payload });
        return processes;
    }

    if (node.attributes) {
        for (const attr of Array.from(node.attributes)) {
            const attrName = attr.name.toLowerCase();

            if (attrName.startsWith('use:')) {
                const match = attr.value.match(/^{{\s*(.+?)\s*}}$/);
                const func_name = attrName.slice(4);
                const func_attr = !match ? "" : match[1];

                processes.push({ type: process_type_enum.directiveUse, func_name, func_attr });
                node.removeAttribute(attrName);
            } else if (attrName.startsWith('bind:')) {
                const input_type = attrName.slice(5);
                const event_type_dic = {
                    "checked": node.type === "date" ? "change" : "click",
                    "value": node.tagName === "select" ? "change" : "input",
                };
                const matched_event_type = event_type_dic[input_type] ? event_type_dic[input_type] : input_type;

                processes.push({ type: process_type_enum.directiveBind, event_type: matched_event_type, input_type, value: attr.value });
                node.removeAttribute(attrName);
            } else if (attrName.startsWith('on')) {
                const match = attr.value.match(/^{{\s*(.+?)\s*}}$/);
                const expr = !match ? "" : match[1];
                const event_type = attrName.slice(2);

                processes.push({ type: process_type_enum.eventListener, event_type, expr });
                node.removeAttribute(attrName);
            } else if (attr.value.includes('{{')) {
                const expr = `\`${attr.value.replace(/{{\s*(.+?)\s*}}/g, (_, e) => "${" + e + "}")}\``;
                processes.push({ type: process_type_enum.attributeInterpolation, expr, attr_name: attrName });
                node.removeAttribute(attrName);
            }
        };
    }

    const childNodes = Array.from(node.childNodes);
    if (childNodes.length <= 0) return processes;

    for (let i = 0; i < childNodes.length; i++) {
        const sub_process = preprocessNode(childNodes[i]);
        if (sub_process.length <= 0) continue;
        processes.push({ type: process_type_enum.children, processes: sub_process, child_node_index: i });
    }

    // the `.reverse()` is important to keep node index in sync when applying processes
    return processes.reverse();
}

/**
 * The purpose of this function is to apply data bindings or node replacement to nodes deemed dynamic after running it through `preprocessNode` function
 * @param {Node} node
 * @param {Record<string, any>[]} processes
 * @param {any} ctx
 * @param {() => DocumentFragment} render_slot_callbackfn
 */
function applyProcess(node, processes, ctx, render_slot_callbackfn) {
    const parent = node.parentNode;
    for (const process of processes) {
        switch (process.type) {
            case process_type_enum.textInterpolation: {
                applyTextInterpolation(node, process, ctx);
                break;
            }
            case process_type_enum.attributeInterpolation: {
                applyAttributeInterpolation(node, process, ctx)
                break;
            }
            case process_type_enum.eventListener: {
                applyEventListener(node, process, ctx);
                break;
            }
            case process_type_enum.directiveUse: {
                applyDirectiveUse(node, process, ctx);
                break;
            }
            case process_type_enum.directiveBind: {
                applyDirectiveBind(node, process, ctx);
                break;
            }
            case process_type_enum.slotInjection: {
                if (!render_slot_callbackfn) break;
                const parent = node.parentNode;
                parent.replaceChild(render_slot_callbackfn(), node);
                break;
            }
            case process_type_enum.coreComponent: {
                const component = ctx[process.component_name]?.default;
                if (!component) throw new Error(`Core component "${process.component_name}" is undefined. Check if the component has a default export`);

                const [nodeStart, nodeEnd] = createStartEndNode(process.marker_type);
                const fragment = document.createDocumentFragment();
                fragment.append(nodeStart, nodeEnd);

                applyCoreComponent(component, process, nodeStart, nodeEnd, ctx);

                parent.replaceChild(fragment, node);
                break;
            }
            case process_type_enum.markedBlocks: {
                const [nodeStart, nodeEnd] = createStartEndNode(process.marker_type);
                const fragment = document.createDocumentFragment();
                fragment.append(nodeStart, nodeEnd);

                switch (process.marker_type) {
                    case "await":
                        applyAwaitBlock(process.payload, nodeStart, nodeEnd, ctx);
                        break;
                    case "if":
                        applyIfBlock(process.payload, nodeStart, nodeEnd, ctx);
                        break;
                    case "each":
                        applyEachBlock(process.payload, nodeStart, nodeEnd, ctx);
                        break;
                    case "component":
                        applyComponents(process.payload, nodeStart, nodeEnd, ctx);
                        break;
                }

                parent.replaceChild(fragment, node);
                break;
            }
            case process_type_enum.children: {
                const child_node = node.childNodes[process.child_node_index];
                applyProcess(child_node, process.processes, ctx, render_slot_callbackfn)
                break;
            }
        }
    }
    return node;
}

/**
 * @param {Function} component
 * @param {{ slot_nodes : DocumentFragment, props : Record<string, string>, dynamicProps : { name : string, value : string, func : Function }[] }} process
 * @param {Node} nodeStart
 * @param {Node} nodeEnd
 * @param {any} ctx
 */
function applyCoreComponent(component, process, nodeStart, nodeEnd, ctx) {
    const ctxKeys = Object.keys(ctx);
    const ctxValues = ctxKeys.map(k => ctx[k]);
    const props = process.props;

    if (process.dynamicProps.length > 0 && !process.dynamicProps[0].func) {
        process.dynamicProps = process.dynamicProps.map((dynamicProp) => {
            dynamicProp.func = evaluateRaw(dynamicProp.value.substring(2, dynamicProp.value.length - 2), ctxKeys)
            return dynamicProp;
        });
    }

    effect(() => {
        removeNodesBetween(nodeStart, nodeEnd);
        const renderSlotCallbackfn = !process.slot_nodes ? null : () => createFragment(process.slot_nodes, ctx);
        for (const dynamicProp of process.dynamicProps) props[dynamicProp.name] = dynamicProp.func(...ctxValues);
        nodeEnd.before(component(props, renderSlotCallbackfn));
    })
}

// make individual value of an array as a read-only Signal because it messes up reactivity
const IS_READ_ONLY_SIGNAL = Symbol("is_read_only_signal");

/** @typedef {{ expression: string; mainContent: DocumentFragment; emptyContent: DocumentFragment; blockVar: string; blockVars: string[]; indexVar: string; }} EachConfig */

/**
 * @param {EachConfig} eachConfig
 * @param {any[]} blockDatas
 * @param {number} index
 * @param {any} ctx
 * @param {Node} currentNode
 */
function createEachBlock(eachConfig, blockDatas, index, ctx, currentNode) {
    /** @type {Set<Function>} */
    const onUnmountSet = new Set();
    /** @type {Set<Function>} */
    const onMountSet = new Set();
    /** @type {Function} */
    let cleanupEffect;

    function unmount() {
        if (typeof cleanupEffect === "function") cleanupEffect();
        for (const unmount of onUnmountSet) unmount();
        onUnmountSet.clear();
    };

    function mount() {
        for (const mount of onMountSet) mount();
        onMountSet.clear();
    }

    const [nodeStart, nodeEnd] = createStartEndNode('each-block-' + index);

    currentNode.before(nodeStart, nodeEnd);

    const blockData = createSignal(blockDatas[index]);
    blockData[IS_READ_ONLY_SIGNAL] = true;
    const blockIndex = createSignal(index);

    const block = {
        nodeStart,
        nodeEnd,
        unmount,
        index: blockIndex,
        data: blockData,
    };

    const childCtx = (eachConfig.blockVars.length > 0) ? {
        ...ctx,
        ...(eachConfig.blockVars.reduce((obj, key) => {
            obj[key] = makeFuncSignal(() => blockData()[key]);
            obj[key].set = (v) => blockData()[key] = v;
            obj[key].update = (fn) => blockData()[key] = fn(blockData[key])
            return obj;
        }, {})),
    } : {
        ...ctx,
        [eachConfig.blockVar]: blockData,
    };

    if (eachConfig.indexVar) childCtx[eachConfig.indexVar] = () => blockIndex();

    cleanupEffect = untrackedEffect(() => {
        const mainBlock = runScopedMountUnmount(onMountSet, onUnmountSet, () => createFragment(eachConfig.mainContent, childCtx));
        nodeEnd.before(mainBlock);

        if (core_context.is_mounted_to_the_DOM) return mount();

        core_context.onMountSet.add(mount)
        core_context.onUnmountSet.add(unmount)
    });

    return block;
}

const eachBlockKey = (obj, i) => isObject(obj) ? obj : i;

/**
 * @param {EachConfig} eachConfig
 * @param {Node} startNode
 * @param {Node} endNode
 * @param {any} ctx
 */
function applyEachBlock(eachConfig, startNode, endNode, ctx) {

    // THIS SECTION IS FOR EMPTY BLOCK MOUNT/UNMOUNT

    /** @type {Set<Function>} */
    const onUnmountSet = new Set();
    /** @type {Set<Function>} */
    const onMountSet = new Set();

    function unmount() {
        for (const unmount of onUnmountSet) unmount();
        onUnmountSet.clear();
    };

    function mount() {
        for (const mount of onMountSet) mount();
        onMountSet.clear();
    }

    // END OF EMPTY BLOCK

    function unmountEachBlock() {
        for (const renderBlock of renderedBlocks) renderBlock.unmount();
        renderedBlocks = [];
    };

    const parentOnUnmountSet = onUnmountQueue[onUnmountQueue.length - 1];
    if (parentOnUnmountSet && !parentOnUnmountSet.has(unmountEachBlock)) parentOnUnmountSet.add(unmountEachBlock);

    /** @typedef {{ nodeStart:Node, nodeEnd:Node, data:{ ():any, set:(new_value:any) => void }, index : { ():number, set(new_index:number) => void }, unmount:Function }} EachBlock */

    /** @type {EachBlock[]} */
    let renderedBlocks = [];

    /** @type {Map<any, EachBlock>} */
    let renderedBlockMap = new Map();
    let isEmptyBlockMounted = false;

    const ctxKeys = Object.keys(ctx);
    const ctxValues = ctxKeys.map(k => ctx[k]);
    let func = cacheAppliedProcesses.get(eachConfig);
    if (!func) {
        func = evaluateRaw(eachConfig.expression, ctxKeys);
        cacheAppliedProcesses.set(eachConfig, func);
    }

    effect(() => {
        let currentNode = endNode;

        /** @type {EachBlock[]} */
        const newRenderedBlocks = [];
        /** @type {any[]} */
        const blockDatas = func(...ctxValues) || [];

        if (blockDatas.length <= 0 && !isEmptyBlockMounted) {
            isEmptyBlockMounted = true;

            if (renderedBlocks.length > 0) {
                for (const block of renderedBlocks) block.unmount();
                removeNodesBetween(startNode, endNode);
                renderedBlocks = [];
                renderedBlockMap.clear();
            }

            if (eachConfig.emptyContent.length <= 0) return;

            const [nodeStart, nodeEnd] = createStartEndNode('each-block');

            currentNode.before(nodeStart, nodeEnd);

            const emptyBlock = runScopedMountUnmount(onMountSet, onUnmountSet, () => createFragment(eachConfig.emptyContent, ctx))
            nodeEnd.before(emptyBlock);

            onUnmountSet.add(() => {
                removeNodesBetween(nodeStart, nodeEnd);
                nodeStart.remove();
                nodeEnd.remove();
            })

            if (core_context.is_mounted_to_the_DOM) return mount();

            core_context.onMountSet.add(mount)
            core_context.onUnmountSet.add(unmount)
            return;
        }

        isEmptyBlockMounted = false;
        unmount();

        // CREATE NEW BLOCKS FROM SCRATCH
        if (renderedBlocks.length <= 0) {
            for (let index = 0; index < blockDatas.length; index++) {
                const block = createEachBlock(eachConfig, blockDatas, index, ctx, currentNode);
                renderedBlocks.push(block);
                renderedBlockMap.set(eachBlockKey(blockDatas[index], index), block);
                currentNode = block.nodeEnd.nextSibling;
            }
            return;
        }

        /** @type {Map<any, EachBlock>} */
        const newRenderedBlockMap = new Map();

        // FIND EXISTING BLOCK WITH THE SAME VALUE, UPDATE EXISTING BLOCK WITH NEW VALUE, or CREATE NEW BLOCKS
        for (let index = 0; index < blockDatas.length; index++) {
            const renderedBlock = renderedBlocks[index];
            let block = renderedBlockMap.get(eachBlockKey(blockDatas[index], index));

            if (block && block.data() === blockDatas[index]) {
                if (block.index() !== index) block.index.set(index);
            } else if (renderedBlock) {
                if (renderedBlock.data() !== blockDatas[index]) renderedBlock.data.set(blockDatas[index]);
                block = renderedBlock;
            } else {
                block = createEachBlock(eachConfig, blockDatas, index, ctx, currentNode);
            }

            newRenderedBlocks.push(block);
            newRenderedBlockMap.set(eachBlockKey(blockDatas[index], index), block);
            currentNode = block.nodeEnd.nextSibling;
        }

        // REMOVE UNUSED BLOCKS
        /** @type {Node} */
        let nodeStart;
        /** @type {Node} */
        let nodeEnd;

        for (let i = 0; i < renderedBlocks.length; i++) {
            const renderBlock = renderedBlocks[i];

            if (newRenderedBlockMap.get(eachBlockKey(renderBlock.data(), i))) {
                if (!nodeStart && !nodeEnd) continue;
                removeNodesBetween(nodeStart, nodeEnd);
                nodeStart.remove();
                nodeEnd.remove();
                nodeStart = null;
                nodeEnd = null;
                continue;
            }

            renderBlock.unmount();

            if (!nodeStart) nodeStart = renderBlock.nodeStart;
            nodeEnd = renderBlock.nodeEnd;
        }

        if (nodeStart && nodeEnd) {
            removeNodesBetween(nodeStart, nodeEnd);
            nodeStart.remove();
            nodeEnd.remove();
            nodeStart = null;
            nodeEnd = null;
        }

        renderedBlockMap.clear();
        renderedBlockMap = newRenderedBlockMap;
        renderedBlocks = newRenderedBlocks;

        let previousNode = startNode;

        // RE-ORDER BLOCKS
        for (let i = 0; i < renderedBlocks.length; i++) {
            const renderBlock = renderedBlocks[i];

            if (renderBlock.nodeStart.previousSibling && renderBlock.nodeStart.previousSibling !== previousNode) {
                /** @type {EachBlock} */
                let nextRenderBlock;

                for (let j = i + 1; j < renderedBlocks.length; j++) {
                    nextRenderBlock = renderedBlocks[j];
                    if (nextRenderBlock.nodeStart.previousSibling !== previousNode) continue;
                    break;
                }

                if (!nextRenderBlock) return console.warn("nextRenderBlock is undefined");

                const renderAnchor = nextRenderBlock.nodeEnd.nextSibling;
                const nextAnchor = renderBlock.nodeEnd.nextSibling;

                if (!nextAnchor) return console.warn("nextAnchor is undefined");

                /** @type {Node} */
                let node;
                /** @type {Node} */
                let next;

                let fragment = document.createDocumentFragment();

                node = nextRenderBlock.nodeStart;
                while (node) {
                    next = node.nextSibling;
                    fragment.append(node);
                    if (node === nextRenderBlock.nodeEnd) break;
                    node = next;
                }

                nextAnchor.before(fragment);

                fragment = document.createDocumentFragment();
                node = renderBlock.nodeStart;
                while (node) {
                    next = node.nextSibling;
                    fragment.append(node);
                    if (node === renderBlock.nodeEnd) break;
                    node = next;
                }

                renderAnchor.before(fragment);
            }

            previousNode = renderBlock.nodeEnd;
        }
    })
}

/**
 * @param {{ promiseExpr:string, pendingContent:DocumentFragment, then: { match:Boolean, var:string | null, content:DocumentFragment }, catch: { match:Boolean, var:string | null, content:DocumentFragment } }} awaitConfig
 * @param {Node} startNode
 * @param {Node} endNode
 * @param {any} ctx
 */
function applyAwaitBlock(awaitConfig, startNode, endNode, ctx) {
    /** @type {Set<Function>} */
    const onUnmountSet = new Set();
    /** @type {Set<Function>} */
    const onMountSet = new Set();

    function unmount() {
        for (const unmount of onUnmountSet) unmount();
        onUnmountSet.clear();
    };

    function mount() {
        for (const mount of onMountSet) mount();
        onMountSet.clear();
    }

    const parentOnUnmountSet = onUnmountQueue[onUnmountQueue.length - 1];
    if (parentOnUnmountSet && !parentOnUnmountSet.has(unmount)) parentOnUnmountSet.add(unmount);

    const contextQueue = copyContextQueue();

    function mountInit() {
        if (core_context.is_mounted_to_the_DOM) return mount();
        core_context.onMountSet.add(mount);
        core_context.onUnmountSet.add(unmount);
    }

    function showLoading() {
        unmount();
        removeNodesBetween(startNode, endNode);

        const nodes = runScopedMountUnmount(onMountSet, onUnmountSet, () => createFragment(awaitConfig.pendingContent, ctx));
        endNode.before(nodes);

        mountInit();
    };

    const showThen = (result) => {
        unmount();
        removeNodesBetween(startNode, endNode);
        if (!awaitConfig.then.match) return;

        const resetContextQueue = setContextQueue(contextQueue);
        const nodes = runScopedMountUnmount(onMountSet, onUnmountSet, () => createFragment(awaitConfig.then.content, awaitConfig.then.var ? { ...ctx, [awaitConfig.then.var]: result } : ctx))
        resetContextQueue();

        endNode.before(nodes);

        mountInit();
    };

    const showCatch = (error) => {
        unmount();
        removeNodesBetween(startNode, endNode);
        if (!awaitConfig.catch.match) return;

        const resetContextQueue = setContextQueue(contextQueue);
        const nodes = runScopedMountUnmount(onMountSet, onUnmountSet, () => createFragment(awaitConfig.catch.content, awaitConfig.catch.var ? { ...ctx, [awaitConfig.catch.var]: error } : ctx));
        resetContextQueue();

        endNode.before(nodes);

        mountInit();
    };

    /** @type {string} */
    let lastPromiseId;

    const ctxKeys = Object.keys(ctx);
    const ctxValues = ctxKeys.map(k => ctx[k]);
    const func = evaluateRaw(awaitConfig.promiseExpr, ctxKeys);

    effect(() => {
        const currentPromiseId = Math.random();
        lastPromiseId = currentPromiseId;
        const promise = func(...ctxValues);

        if (!(promise instanceof Promise)) {
            if (lastPromiseId === currentPromiseId) showThen(promise);
            return;
        }

        showLoading();
        promise.then((result) => {
            if (lastPromiseId == currentPromiseId) showThen(result);
        }).catch(showCatch);
    })
}

/**
 * @param {{ block : string, condition : string }[]} segments
 * @param {Node} startNode
 * @param {Node} endNode
 * @param {any} ctx
 */
function applyIfBlock(segments, startNode, endNode, ctx) {
    /** @type {Set<Function>} */
    const onUnmountSet = new Set();
    /** @type {Set<Function>} */
    const onMountSet = new Set();
    /** @type {Function} */
    let cleanup;

    function unmount() {
        if (typeof cleanup === "function") cleanup();
        for (const unmount of onUnmountSet) unmount();
        onUnmountSet.clear();
    };

    function mount() {
        for (const mount of onMountSet) mount();
        onMountSet.clear();
    }

    const parentOnUnmountSet = onUnmountQueue[onUnmountQueue.length - 1];
    if (parentOnUnmountSet && !parentOnUnmountSet.has(unmount)) parentOnUnmountSet.add(unmount);

    /** @type {{ block: string; condition: string; }} */
    let previousCondition;

    let segmentFuncs = cacheAppliedProcesses.get(segments);
    const ctxKeys = Object.keys(ctx);
    const ctxValues = ctxKeys.map(k => ctx[k]);

    if (!segmentFuncs) {
        segmentFuncs = [];
        for (const segment of segments) segmentFuncs.push(evaluateRaw(segment.condition, ctxKeys));
        cacheAppliedProcesses.set(segments, segmentFuncs);
    }

    effect(() => {
        /** @type {{ block: string; condition: string; }} */
        let condition;

        for (let i = 0; i < segmentFuncs.length; i++) {
            const func = segmentFuncs[i];
            if (!func(...ctxValues)) continue;
            condition = segments[i];
            break;
        }

        if (!condition) {
            previousCondition = null; // remember to remove the previous condition if there is none, or else it won't re-render
            unmount();
            removeNodesBetween(startNode, endNode);
            return;
        }

        if (condition === previousCondition) return;
        previousCondition = condition;

        cleanup = untrackedEffect(() => {
            unmount();
            removeNodesBetween(startNode, endNode);

            const segmentBlock = runScopedMountUnmount(onMountSet, onUnmountSet, () => createFragment(condition.block, ctx))
            endNode.before(segmentBlock);

            if (core_context.is_mounted_to_the_DOM) return mount();

            core_context.onMountSet.add(mount)
            core_context.onUnmountSet.add(unmount)
        })
    })
}

/**
 * @param {{ import_id : number, tag : string, attrStr : string, slot_node : DocumentFragment | null }} component
 * @param {Node} startNode
 * @param {Node} endNode
 * @param {any} ctx
 */
function applyComponents(component, startNode, endNode, ctx) {
    const components = imported_components.get(component.import_id);
    if (!components) throw new Error(`You currently have no component imported. Unable to find "<${component.tag}>". Import component before proceeding`);

    let componentFunc = components[component.tag];
    if (!componentFunc) throw new Error(`Component "<${component.tag}>" does not exist. Importing it will fix this issue`);

    const ctxKeys = Object.keys(ctx);
    const ctxValues = ctxKeys.map((k) => ctx[k]);

    /** @type {{ [key:string] : any }} */
    const props = {};
    /** @type {{ key:string, func:Function }[]} */
    let dynamicProps = cacheAppliedProcesses.get(component);

    if (!dynamicProps) {
        const regex = /([:@\w-]+)(?:\s*=\s*"([^"]*)")?/g;
        let match;

        dynamicProps = [];
        while ((match = regex.exec(component.attrStr)) !== null) {
            const [_, key, value] = match;
            if (value && value.startsWith('{{')) {
                dynamicProps.push({ key, func: evaluateRaw(value.match(/^{{\s*(.+?)\s*}}$/)[1], ctxKeys) });
            } else {
                props[key] = value;
            }
        }
        cacheAppliedProcesses.set(component, dynamicProps);
    }

    effect(() => {
        removeNodesBetween(startNode, endNode);
        for (const dynamicProp of dynamicProps) props[dynamicProp.key] = dynamicProp.func(...ctxValues);
        const componentBlock = componentFunc(props, (component.slot_node) ? () => createFragment(component.slot_node, ctx) : null)
        endNode.before(componentBlock);
    })
}

/**
 * @param {Node} node
 * @param {{ expr : string }} process
 * @param {any} ctx
 */
function applyTextInterpolation(node, process, ctx) {
    const ctxKeys = Object.keys(ctx);
    const ctxValues = ctxKeys.map(k => ctx[k]);
    let func = cacheAppliedProcesses.get(process);
    if (!func) {
        func = evaluateRaw(process.expr, ctxKeys);
        cacheAppliedProcesses.set(process, func);
    }

    effect(() => {
        let textContent = func(...ctxValues);
        if (node.__cacheText !== textContent) node.textContent = node.__cacheText = textContent;
    })
}

/**
 * @param {Node} node
 * @param {{ expr : string, attr_name : string }} process
 * @param {any} ctx
 */
function applyAttributeInterpolation(node, process, ctx) {
    const ctxKeys = Object.keys(ctx);
    const ctxValues = ctxKeys.map(k => ctx[k]);

    let func = cacheAppliedProcesses.get(process);
    if (!func) {
        func = evaluateRaw(process.expr, ctxKeys);
        cacheAppliedProcesses.set(process, func);
    }

    effect(() => {
        const new_attr = func(...ctxValues);
        if (node.__cacheAttr === new_attr) return;
        node.__cacheAttr = new_attr;

        if (process.attr_name === "value")
            node.value = new_attr;
        else if (new_attr === 'false' || new_attr === '')
            node.removeAttribute(process.attr_name);
        else
            node.setAttribute(process.attr_name, new_attr === 'true' ? '' : new_attr)
    })
}

const nonBubblingEvents = new Set([
    // Focus
    "focus",
    "blur",
    // Mouse
    "mouseenter",
    "mouseleave",
    // Resource loading
    "load",
    "unload",
    "error",
    "abort",
    // Scrolling
    "scroll",
    // Media
    "play",
    "playing",
    "pause",
    "ended",
    // Animation/Transition
    "animationstart",
    "animationend",
    "animationiteration",
    "transitionend"
]);

/**
 * @param {Node} node
 * @param {{ expr : string, event_type : string }} process
 * @param {any} ctx
 */
function applyEventListener(node, process, ctx) {
    const isNonBubbling = nonBubblingEvents.has(process.event_type);
    const ctxKeys = Object.keys(ctx);
    const ctxValues = ctxKeys.map(k => ctx[k]);
    let func = cacheAppliedProcesses.get(process);
    if (!func) {
        func = evaluateRaw(process.expr, ctxKeys);
        cacheAppliedProcesses.set(process, func);
    }

    effect(() => {
        if (!isNonBubbling) return coreEventListener.add(process.event_type, node, func(...ctxValues));
        node.addEventListener(process.event_type, func(...ctxValues));
        return () => node.removeEventListener(process.event_type, func(...ctxValues));
    })
}

/**
 * @param {Node} node
 * @param {{ func_name : string, func_attr : string | null }} process
 * @param {any} ctx
 */
function applyDirectiveUse(node, process, ctx) {
    const func = ctx[process.func_name];
    if (!func) throw new Error(`use: directive "${process.func_name}" not found.`);
    if (typeof func !== "function") throw new Error(`function "${process.name}" is not a function`);

    const onUnmountSet = onUnmountQueue[onUnmountQueue.length - 1];
    const onMountSet = onMountQueue[onMountQueue.length - 1];
    const ctxKeys = Object.keys(ctx);
    const ctxValues = ctxKeys.map(k => ctx[k]);

    let ctxFunc = cacheAppliedProcesses.get(process);
    if (!ctxFunc) {
        ctxFunc = evaluateRaw(process.func_attr, ctxKeys);
        cacheAppliedProcesses.set(process, func);
    }

    onMountSet.add(() => {
        const cleanup = func(node, process.func_attr ? ctxFunc(...ctxValues) : undefined);
        if (typeof cleanup === "function") onUnmountSet.add(cleanup);
    });
}

/**
 * @param {Node} node
 * @param {{ value:string, input_type: string, event_type: string }} process
 * @param {any} ctx
 */
function applyDirectiveBind(node, process, ctx) {
    const ctxKeys = Object.keys(ctx);
    const ctxValues = ctxKeys.map(k => ctx[k]);
    const binding = evaluateRaw(`(v, c, s) => {
        try {
            if (c(${process.value})) {
                if (${process.value}[s]) throw new Error("signal is read-only");
                ${process.value}.set(v)
            } else {
                ${process.value} = v;
            }
        } catch (error) {
            console.error(error);
        }
    }`, ctxKeys)(...ctxValues);

    const eventListener = (event) => {
        const type = event.target.type;
        if (type === "date") return binding(new Date(event.target[process.input_type]), isSignal, IS_READ_ONLY_SIGNAL);
        return binding(event.target[process.input_type], isSignal, IS_READ_ONLY_SIGNAL);
    };

    const remove_listener = coreEventListener.add(process.event_type, node, eventListener);
    const unmountSet = onUnmountQueue[onUnmountQueue.length - 1];
    unmountSet.add(remove_listener);

    const func = evaluateRaw(process.value, ctxKeys);

    effect(() => {
        let value = func(...ctxValues);
        value = isSignal(value) ? value() : value;

        if (node.type === "date") {
            if (!(value instanceof Date)) throw new Error("input value is not a valid Date");
            node[process.input_type] = value.toISOString().split('T')[0];
            return;
        }

        node[process.input_type] = value;
    })
}

/**
* @param {string} expr
* @param {string[]} ctx_keys
*/
export function evaluateRaw(expr, ctx_keys) {
    if (!expr || typeof expr !== "string") throw new Error("expr is not a string or empty");
    const funcMapKey = `${expr}${ctx_keys.join('')}`;
    let evalFunc = evaluationCache.get(funcMapKey);
    if (!evalFunc) {
        evalFunc = new Function(...ctx_keys, `return ${expr};`);
        evaluationCache.set(funcMapKey, evalFunc);
    }
    return evalFunc;
}

/**
 * NOTE: this will create a single global listener of a specific event(like 'click' or 'keyup'
 * but that global listener will stay persistent through out the app life-cycle, it will not be dispose of
 */
export const coreEventListener = Object.freeze({
    /**
     * @param {string} event_name
     * @param {Node} node
     * @param {Function} func
     * @returns {() => void} dispose event listener
     */
    add: function (event_name, node, func) {
        if (typeof func !== "function") throw new Error("func is not a function");
        let event_node_weakmap = delegated_events.get(event_name);

        if (!event_node_weakmap) {
            event_node_weakmap = new WeakMap();
            const funcs = new Set();
            funcs.add(func);

            event_node_weakmap.set(node, funcs);
            delegated_events.set(event_name, event_node_weakmap);

            window.addEventListener(event_name, (e) => match_delegated_node(event_node_weakmap, e, e.target));

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
