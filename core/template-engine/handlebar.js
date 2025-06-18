import { core_context, onMountQueue, onUnmountQueue, evaluate, event_delegation } from "../internal-core.js";
import { onMount } from "../core.js";
import { effect, untrackedEffect, State } from "../reactivity.js";
import { createStartEndNode, makeId, removeNodesBetween, newSetFunc, parseOuterBlocks } from "../helper-functions.js";

/**
* @type {Map<string, Node[]>}
*/
const slotCache = new Map();

/**
* @type {Map<string, (startNode:Node, endNode:Node, ctx:any) => void>}
*/
const processedBlocks = new Map();

/**
* @type {Map<number, Record<string, Function>>}
*/
const imported_components = new Map();

/**
* @type {WeakMap<Node, Node[]>}
*/
const nodeChildren = new WeakMap();

/**
* @type {WeakMap<Node, ((node:Node, ctx:any, render_slot_callbackfn:(() => DocumentFragment)) => void)>}
*/
const cacheNodeProcesses = new WeakMap();

if (window.__corejs__) {
    window.__corejs__.processedBlocks = processedBlocks;
    window.__corejs__.slotCache = slotCache;
    window.__corejs__.nodeChildren = nodeChildren;
    window.__corejs__.imported_components = imported_components;
    window.__corejs__.cacheNodeProcesses = cacheNodeProcesses;
}

// ============================= //

let imported_components_id_counter = 1;

/**
* @param {{ template : string, components : Record<string, Function> }} options
* @param {Object} Context anonymous class that encapsulate logic
* @returns {(attrs:Record<string, any>) => DocumentFragment}
*/
export function component(options, Context = class { }) {

    const imported_components_id = imported_components_id_counter;
    imported_components_id_counter++;

    let template = preprocessComponents(options.template, imported_components_id, processComponent);
    if (options.components && Object.keys(options.components).length > 0) imported_components.set(imported_components_id, options.components);

    const nodes = createNodes(preprocessTemplateString(template));

    if (Context && Context.toString().substring(0, 5) !== "class") throw new Error("context is not a class instance");

    return function (attrs, render_slot_callbackfn) {
        const ctx = !Context ? {} : new Context(attrs);
        return createFragment(nodes, ctx, render_slot_callbackfn);
    }
}

/**
* @param {string} template
*/
function createNodes(template) {
    if (template == "" || typeof template !== "string") return [];

    const templateElement = document.createElement("template");
    templateElement.innerHTML = template;

    const preprocessed_childNodes = Array.from(templateElement.content.childNodes);
    for (const childNode of preprocessed_childNodes) preprocessTextNodes(childNode);

    const childNodes = Array.from(templateElement.content.childNodes);

    for (const childNode of childNodes) {
        const processes = preprocessNode(childNode);
        if (processes.length <= 0) continue;
        cacheNodeProcesses.set(childNode, processes);
    }

    return childNodes;
}

/**
* @param {Node[]} nodes
* @param {Record<string, any>} ctx
* @param {Function} render_slot_callbackfn
*/
function createFragment(nodes, ctx, render_slot_callbackfn) {

    const fragment = document.createDocumentFragment();

    for (const node of nodes) {
        const clone_node = node.cloneNode(true);
        fragment.append(clone_node);
        const processes = cacheNodeProcesses.get(node);
        if (processes) applyProcess(clone_node, processes, ctx, render_slot_callbackfn);
    }

    return fragment;
}

/**
* @param {string} eachBlock
*/
function processEachBlock(eachBlock) {
    const eachRegex = /{{#each\s+(.+?)\s+as\s+(\w+)(?:,\s*(\w+))?}}([\s\S]*?){{\/each}}/g;
    let eachConfig = { expression: "", mainContent: [], emptyContent: [], blockVar: "", indexVar: "" }

    eachBlock.replace(eachRegex, (_, expression, blockVar, indexVar, content) => {
        const [mainContent, emptyContent] = content.split(/{{:empty}}/);
        eachConfig = { expression, blockVar, indexVar, mainContent: createNodes(mainContent), emptyContent: emptyContent ? createNodes(emptyContent) : [] };
    });

    return eachConfig;
}

/**
* @param {string} ifBlock
*/
function processIfBlock(ifBlock) {
    const ifRegex = /{{#if\s+(.+?)}}([\s\S]*?){{\/if}}/g;
    const ifElseregex = /{{:else\s+if\s+(.+?)}}|{{:else}}/g;

    /**
    * @type {{ block : string, condition : string }[]}
    */
    const segments = [];

    ifBlock.replace(ifRegex, (_, firstCondition, firstBlock) => {
        let lastIndex = 0;
        let match;

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

        if (lastIndex < firstBlock.length) {
            segments.push({
                condition: firstCondition,
                block: createNodes(firstBlock.substring(lastIndex))
            });
        }
    });

    return segments;
}

/**
* @param {string} awaitBlock
*/
function processAwaitBlock(awaitBlock) {
    const awaitRegex = /{{#await\s+(.+?)}}([\s\S]*?){{\/await}}/g;
    const thenRegex = /\{\{:then(?:\s+(\w+))?\}\}(.*?)(?={{:|$)/s;
    const catchRegex = /\{\{:catch(?:\s+(\w+))?\}\}(.*?)(?={{:|$)/s;
    const blockRegex = /{{:then[\s\S]*?}}|{{catch[\s\S]*?}}/;

    const awaitConfig = {
        promiseExpr: "",
        pendingContent: [],
        then: { match: false, var: null, expr: "", content: [], },
        catch: { match: false, var: null, expr: "", content: [], },
    }

    awaitBlock.replace(awaitRegex, (_, promiseExpr, block) => {
        awaitConfig.promiseExpr = promiseExpr;

        const thenMatch = block.match(thenRegex);
        if (thenMatch) {
            const [_, thenVar, thenContent] = thenMatch;
            awaitConfig.then = { match: true, var: thenVar, content: thenContent ? createNodes(thenContent) : [] };
        }

        const catchMatch = block.match(catchRegex);
        if (catchMatch) {
            const [_, catchVar, catchContent] = thenMatch;
            awaitConfig.catch = { match: true, var: catchVar, content: catchContent ? createNodes(catchContent) : [] };
        }

        const pendingContent = block.split(blockRegex)[0] || '';
        awaitConfig.pendingContent = createNodes(pendingContent);
    });

    return awaitConfig;
}

/**
* @param {{ import_id:number, tag : string, attrStr : string, slot_id : number }} component
*/
function processComponent(component) {

    const slotNodes = component.slot_id ? slotCache.get(component.slot_id) : null;

    return function (startNode, endNode, ctx) {
        removeNodesBetween(startNode, endNode);

        const components = imported_components.get(component.import_id);
        if (!components) throw new Error(`You currently have no component imported. Unable to find "<${component.tag}>". Import component before proceeding`);

        let componentFunc = components[component.tag];
        if (!componentFunc) throw new Error(`Component "<${component.tag}>" does not exist. Importing it will fix this issue`);

        const attrs = {};
        const regex = /([:@\w-]+)(?:\s*=\s*"([^"]*)")?/g;

        let match;
        while ((match = regex.exec(component.attrStr)) !== null) {
            const [, key, value] = match;
            attrs[key] = value && value.startsWith('{{') ? evaluate(value.match(/^{{\s*(.+?)\s*}}$/)[1], ctx) : value;
        }

        let componentBlock;

        if (slotNodes) {
            const renderSlotCallbackfn = () => createFragment(slotNodes, ctx);
            componentBlock = componentFunc(attrs, renderSlotCallbackfn)
        } else {
            componentBlock = componentFunc(attrs);
        }

        endNode.parentNode.insertBefore(componentBlock, endNode);
    }
}

// ====================================================

/**
* Process and store all `{{#..}}` directives to be used later when rendering
* @param {string} template
*/
function preprocessTemplateString(template) {
    template = processDirectiveBlocks(template, "await", processAwaitBlock);
    template = processDirectiveBlocks(template, "if", processIfBlock);
    template = processDirectiveBlocks(template, "each", processEachBlock);
    return template;
}

/**
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

        const start = blocks[i].match(new RegExp(`\\{\\{#${directive}\\s+([^\\}]+)\\}\\}`))[0];
        const end = blocks[i].lastIndexOf(`{{/${directive}}}`);
        const block = blocks[i].slice(0, end).replace(start, "");

        blocks[i] = start + preprocessTemplateString(block) + `{{/${directive}}}`;

        processedBlocks.set(marker_id, processBlocks(blocks[i]));
    }

    return template;
}

/**
* @param {string} template
* @param {number} imported_components_id
* @param {Function} processComponent
*/
function preprocessComponents(template, imported_components_id, processComponent) {
    const componentRegex = /<([A-Z][A-Za-z0-9]*)\s*((?:[^>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>(?:([\s\S]*?)<\/\1>)?/g;
    const directive = "component";

    template = template.replace(componentRegex, (match, tag, attrStr, _, slot_content) => {
        if (match.startsWith("<Core:slot")) return `<template data-directive="slot"></template>`;
        if (match.startsWith("<Core:component")) {
            if (slot_content) {
                const slot_id = `slot-${makeId(6)}`;
                slotCache.set(slot_id, createNodes(slot_content))
                return `<template data-directive="core-component" data-slot-id="${slot_id}" ${attrStr.slice(10)}></template>`;
            }

            return `<template data-directive="core-component" ${attrStr.slice(10)}></template>`;
        }
        const marker_id = `${directive}-${makeId(8)}`;
        const component = { import_id: imported_components_id, tag, attrStr, slot_id: -1 };

        if (slot_content) {
            const slot_id = `slot-${makeId(6)}`;
            slotCache.set(slot_id, createNodes(slot_content));
            component.slot_id = slot_id;
        }

        processedBlocks.set(marker_id, processComponent(component));
        return `<template data-import-id="${imported_components_id}" data-directive="${directive}" data-marker-id="${marker_id}"></template>`;
    })

    return template;
}

/**
* The purpose of this function is to search for text and split them into individual text nodes to for a finer text interpolation
* @param {Node} node
*/
function preprocessTextNodes(node) {
    const isText = node.nodeType === Node.TEXT_NODE;

    if (!isText) {
        const childNodes = Array.from(node.childNodes);
        for (const child_node of childNodes) preprocessTextNodes(child_node);
        return node;
    }

    const expression = node.textContent;
    const parts = expression.split(/({{[^}]+}})/g);

    const has_handlebars = parts.map(p => p.startsWith("{{")).filter(p => p === true).length > 0;
    if (!has_handlebars) return;

    if (parts.length <= 1) return node;

    node.textContent = "";

    for (const part of parts) {
        const textNode = document.createTextNode("");
        textNode.textContent = part;
        node.before(textNode);
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
* The purpose of this function is to search and store the dynamic binding of a node and its children recursively
* so that static nodes are not included when processing a node's dynamic bindings
* @param {Node} node
*/
function preprocessNode(node) {
    const isText = node.nodeType === Node.TEXT_NODE;

    /**
    * @type {((node:Node, ctx:any, render_slot_callbackfn:Function) => void)[]}
    */
    const processes = [];

    if (isText) {
        const expression = node.textContent;
        const regex = /{{\s*([^#\/][^}]*)\s*}}/g;
        const parts = expression.split(/({{[^}]+}})/g);

        const has_handlebars = parts.map(p => p.startsWith("{{")).filter(p => p === true).length > 0;
        if (!has_handlebars) return processes;

        let match, expr;
        expression.replace(regex, (m, e) => { match = m; expr = e; });
        processes.push({ type: process_type_enum.textInterpolation, match, expr, full_expr: expression });
        return processes;
    }

    if (node.nodeType === Node.COMMENT_NODE) return processes;

    const isSlotNode = (node) => Boolean(node.dataset.directive === "slot");
    const isCoreComponentNode = (node) => Boolean(node.dataset.directive === "core-component");
    const isMarkedNode = (node) => Boolean(node.dataset.directive && node.dataset.markerId)

    if (isSlotNode(node)) {
        processes.push({ type: process_type_enum.slotInjection });
        return processes;
    }

    if (isCoreComponentNode(node)) {
        const component_name = node.getAttribute("default");
        const slot_id = node.dataset.slotId;
        const slot_nodes = slot_id ? slotCache.get(slot_id) : null;
        processes.push({ type: process_type_enum.coreComponent, slot_id, slot_nodes, component_name })
        return processes;
    }

    if (isMarkedNode(node)) {
        const marker_type = node.dataset.directive;
        const marker_id = node.dataset.markerId;
        const payload = processedBlocks.get(marker_id);
        if (!payload) throw new Error(`processed template type "${process_type}" with marker id "${marker_id}" does not exists`);
        processes.push({ type: process_type_enum.markedBlocks, marker_type, payload });
        return processes;
    }

    for (const attr of node.attributes) {
        const attrName = attr.name.toLowerCase();
        const attrValue = attr.value;

        if (attrName.startsWith('use:')) {
            const match = attrValue.match(/^{{\s*(.+?)\s*}}$/)[1];
            const func_name = attrName.slice(4);
            const func_attr = !match ? "" : match;

            processes.push({ type: process_type_enum.directiveUse, func_name, func_attr });
            node.removeAttribute(attrName);

        } else if (attrName.startsWith('bind:')) {

            const input_type = attrName.slice(5);
            const event_type_dic = {
                "checked": node.type === "date" ? "change" : "click",
                "value": node.tagName === "select" ? "change" : "input",
            };
            const matched_event_type = event_type_dic[input_type] ? event_type_dic[input_type] : input_type;

            processes.push({ type: process_type_enum.directiveBind, event_type: matched_event_type, input_type, value: attrValue });
            node.removeAttribute(attrName);
        } else if (attrName.startsWith('on')) {

            const expr = attrValue.match(/^{{\s*(.+?)\s*}}$/)[1];
            const event_type = attrName.slice(2);

            processes.push({ type: process_type_enum.eventListener, event_type, expr });
            node.removeAttribute(attrName);

        } else if (attrValue.includes('{{')) {
            let match, expr;
            attrValue.replace(/{{\s*(.+?)\s*}}/g, (m, e) => { match = m; expr = e; })
            processes.push({ type: process_type_enum.attributeInterpolation, match, expr, attr_name: attrName, attr: attrValue });
        }
    };

    const childNodes = Array.from(node.childNodes);
    if (childNodes.length <= 0) return processes;

    for (let i = 0; i < childNodes.length; i++) {
        const sub_process = preprocessNode(childNodes[i]);
        if (sub_process.length <= 0) continue;
        processes.push({ type: process_type_enum.children, processes: sub_process, child_node_index: i });
    }

    return processes;
}

/**
 * The purpose of this function is to avoid recursive function closures which having too many can slow down performance
 * @param {Node} node
 * @param {Record<string, any>[]} processes
 * @param {any} ctx
 * @param {() => DocumentFragment} render_slot_callbackfn
 */
function applyProcess(node, processes, ctx, render_slot_callbackfn) {
    for (const process of processes) {
        switch (process.type) {
            case process_type_enum.textInterpolation: {
                effectTextInterpolation(node, process, ctx);
                break;
            }

            case process_type_enum.attributeInterpolation: {
                effectAttributeInterpolation(node, process, ctx)
                break;
            }

            case process_type_enum.eventListener: {
                effectEventListener(node, process, ctx);
                break;
            }

            case process_type_enum.directiveUse: {
                effectDirectiveUse(node, process, ctx);
                break;
            }

            case process_type_enum.directiveBind: {
                effectDirectiveBind(node, process, ctx);
                break;
            }

            case process_type_enum.slotInjection: {
                onMount(() => node.remove());
                if (!render_slot_callbackfn) return;
                node.before(render_slot_callbackfn());
                break;
            }

            case process_type_enum.coreComponent: {
                const component = ctx[process.component_name]?.default;

                if (!component) {
                    console.error(`Core component "${process.component_name}" is undefined. Check if the component has a default export`);
                    return;
                }

                const attrs = {};

                for (const attr of node.attributes) {
                    const attrName = attr.name;
                    const attrValue = attr.value;
                    attrs[attrName] = attrValue && attrValue.startsWith("{{") ? evaluate(attrValue.match(/^{{\s*(.+?)\s*}}$/)[1], ctx) : attrValue;
                }

                if (process.slot_nodes) {
                    const renderSlotCallbackfn = () => createFragment(process.slot_nodes, ctx);
                    node.before(component(attrs, renderSlotCallbackfn));
                } else {
                    node.before(component(attrs));
                }
                break;
            }

            case process_type_enum.markedBlocks: {
                const [nodeStart, nodeEnd] = createStartEndNode(process.marker_type);
                const fragment = document.createDocumentFragment();

                fragment.append(nodeStart);
                fragment.append(nodeEnd);

                node.before(fragment);

                onMount(() => node.remove())

                if (process.marker_type === "await") {
                    applyAwaitBlock(process.payload, nodeStart, nodeEnd, ctx);
                } else if (process.marker_type === "if") {
                    applyIfBlock(process.payload, nodeStart, nodeEnd, ctx);
                } else if (process.marker_type === "each") {
                    applyEachBlock(process.payload, nodeStart, nodeEnd, ctx)
                }
                break;
            }

            case process_type_enum.children: {
                const child_node = node.childNodes[process.child_node_index];
                applyProcess(child_node, process.processes, ctx, render_slot_callbackfn)
                break;
            }
        }
    }
}

/**
 * @param {{ promiseExpr:string, pendingContent:Node[], then: { match:Boolean, var:string | null, content:Node[] }, catch: { match:Boolean, var:string | null, content:Node[] } }} awaitConfig
 * @param {Node} startNode
 * @param {Node} endNode
 * @param {any} ctx
 */
function applyAwaitBlock(awaitConfig, startNode, endNode, ctx) {
    const onUnmountSet = newSetFunc();
    const onMountSet = newSetFunc();

    const unmount = () => {
        for (const unmount of onUnmountSet) unmount();
        onUnmountSet.clear();
    };

    const mount = () => {
        for (const mount of onMountSet) mount();
        onMountSet.clear();
    }

    const parentOnUnmountSet = onUnmountQueue[onUnmountQueue.length - 1];
    if (parentOnUnmountSet && !parentOnUnmountSet.has(unmount)) parentOnUnmountSet.add(unmount);

    const mountInit = () => {
        if (core_context.is_mounted_to_the_DOM) {
            mount();
            return;
        }

        core_context.onMountSet.add(mount);
        core_context.onUnmountSet.add(unmount);
    }

    const showLoading = () => {
        unmount();
        removeNodesBetween(startNode, endNode);

        onUnmountQueue.push(onUnmountSet);
        onMountQueue.push(onMountSet);

        const nodes = createFragment(awaitConfig.pendingContent, ctx);
        endNode.before(nodes);

        onMountQueue.pop();
        onUnmountQueue.pop();

        mountInit();
    };

    const showThen = (result) => {
        unmount();
        removeNodesBetween(startNode, endNode);

        if (!awaitConfig.then.match) return;

        onUnmountQueue.push(onUnmountSet);
        onMountQueue.push(onMountSet);

        const childCtx = awaitConfig.then.var ? Object.assign(Object.assign({}, ctx), { [awaitConfig.then.var]: result }) : ctx;
        const nodes = createFragment(awaitConfig.then.content, childCtx);
        endNode.before(nodes);

        onMountQueue.pop();
        onUnmountQueue.pop();

        mountInit();
    };

    const showCatch = (error) => {
        console.trace(error);

        unmount();
        removeNodesBetween(startNode, endNode);

        if (!awaitConfig.catch.match) return;

        onUnmountQueue.push(onUnmountSet);
        onMountQueue.push(onMountSet);

        const childCtx = awaitConfig.catch.var ? Object.assign(Object.assign({}, ctx), { [awaitConfig.catch.var]: result }) : ctx;
        const nodes = createFragment(awaitConfig.catch.content, childCtx);
        endNode.before(nodes);

        onMountQueue.pop();
        onUnmountQueue.pop();

        mountInit();
    };

    effect(() => {
        try {
            const promise = evaluate(awaitConfig.promiseExpr, ctx);

            if (promise instanceof Promise) {
                showLoading();
                promise.then(showThen).catch(showCatch);
            } else {
                showThen(promise);
            }
        } catch (err) {
            showCatch(err);
        }
    })
}

/**
 * @param {{ block : string, condition : string }[]} segments
 * @param {Node} startNode
 * @param {Node} endNode
 * @param {any} ctx
 */
function applyIfBlock(segments, startNode, endNode, ctx) {
    const onUnmountSet = newSetFunc();
    const onMountSet = newSetFunc();
    let cleanup;

    const unmount = () => {
        if (cleanup) cleanup();
        for (const unmount of onUnmountSet) unmount();
        onUnmountSet.clear();
    };

    const mount = () => {
        for (const mount of onMountSet) mount();
        onMountSet.clear();
    }

    const parentOnUnmountSet = onUnmountQueue[onUnmountQueue.length - 1];
    if (parentOnUnmountSet && !parentOnUnmountSet.has(unmount)) parentOnUnmountSet.add(unmount);

    let previousCondition;

    effect(() => {
        let condition;

        for (const segment of segments) {
            if (!evaluate(segment.condition, ctx)) continue;
            condition = segment;
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

            onUnmountQueue.push(onUnmountSet);
            onMountQueue.push(onMountSet);

            const segmentBlock = createFragment(condition.block, ctx);
            endNode.parentNode.insertBefore(segmentBlock, endNode);

            onMountQueue.pop();
            onUnmountQueue.pop();

            if (core_context.is_mounted_to_the_DOM) return mount();

            core_context.onMountSet.add(mount)
            core_context.onUnmountSet.add(unmount)
        })
    })
}

/**
 * @param {{ expression: string; mainContent: Node[]; emptyContent: Node[]; blockVar: string; indexVar: string; }} eachConfig
 * @param {any[]} blockDatas
 * @param {number} index
 * @param {any} ctx
 * @param {Node} currentNode
 */
function createEachBlock(eachConfig, blockDatas, index, ctx, currentNode) {
    const onUnmountSet = newSetFunc();
    const onMountSet = newSetFunc();
    let cleanupEffect;

    const unmount = () => {
        if (typeof cleanupEffect === "function") cleanupEffect();
        for (const unmount of onUnmountSet) unmount();
        onUnmountSet.clear();
    };

    const mount = () => {
        for (const mount of onMountSet) mount();
        onMountSet.clear();
    }

    const [nodeStart, nodeEnd] = createStartEndNode('each-block');

    currentNode.parentNode.insertBefore(nodeStart, currentNode.nextSibling);
    currentNode.parentNode.insertBefore(nodeEnd, nodeStart.nextSibling);

    const blockIndex = new State(index);
    const blockData = new State(blockDatas[index]);

    const block = {
        nodeStart,
        nodeEnd,
        unmount,
        index: blockIndex,
    };

    const property = {
        get() {
            return blockData.value;
        },
        set(newValue) {
            blockData.value = newValue;
            return true;
        },
        configurable: true,
        enumerable: true,
    };

    Object.defineProperty(block, "value", property);

    const childCtx = Object.assign({}, ctx);

    Object.defineProperty(childCtx, eachConfig.blockVar, property);

    if (eachConfig.indexVar) {
        Object.defineProperty(childCtx, eachConfig.indexVar, {
            get() {
                return blockIndex.value;
            },
            configurable: true,
            enumerable: true,
        });
    }

    cleanupEffect = untrackedEffect(() => {
        onUnmountQueue.push(onUnmountSet);
        onMountQueue.push(onMountSet);

        const mainBlock = createFragment(eachConfig.mainContent, childCtx);
        nodeEnd.before(mainBlock);

        onMountQueue.pop()
        onUnmountQueue.pop()

        if (core_context.is_mounted_to_the_DOM) {
            mount();
            return;
        }

        core_context.onMountSet.add(mount)
        core_context.onUnmountSet.add(unmount)
    });

    return block;
}

/**
 * @param {{ expression: string; mainContent: Node[]; emptyContent: Node[]; blockVar: string; indexVar: string; }} eachConfig
 * @param {Node} startNode
 * @param {Node} endNode
 * @param {any} ctx
 */
function applyEachBlock(eachConfig, startNode, endNode, ctx) {

    // THIS SECTION IS FOR EMPTY BLOCK MOUNT/UNMOUNT

    const onUnmountSet = newSetFunc();
    const onMountSet = newSetFunc();

    const unmount = () => {
        if (typeof cleanupEffect === "function") cleanupEffect();
        for (const unmount of onUnmountSet) unmount();
        onUnmountSet.clear();
    };

    const mount = () => {
        for (const mount of onMountSet) mount();
        onMountSet.clear();
    }

    // END OF EMPTY BLOCK

    const unmountEachBlock = () => {
        for (const renderBlock of renderedBlocks) {
            renderBlock.unmount();
        };
        renderedBlocks = [];
    };

    const parentOnUnmountSet = onUnmountQueue[onUnmountQueue.length - 1];
    if (parentOnUnmountSet && !parentOnUnmountSet.has(unmountEachBlock))
        parentOnUnmountSet.add(unmountEachBlock);

    /**
    * @type {{ nodeStart:Node, nodeEnd:Node, value:any, index : State<number>, unmount:Function }[]}
    */
    let renderedBlocks = [];
    let isEmptyBlockMounted = false;

    effect(() => {
        const newRenderedBlocks = [];

        let currentNode = startNode;

        const blockDatas = evaluate(eachConfig.expression, ctx) || [];

        if (blockDatas.length <= 0 && !isEmptyBlockMounted) {
            isEmptyBlockMounted = true;

            if (renderedBlocks.length > 0) {
                removeNodesBetween(startNode, endNode);

                for (let i = 0; i < renderedBlocks.length; i++) {
                    const block = renderedBlocks[i];
                    block.unmount();
                    block.index = null;
                }

                renderedBlocks = [];
            }

            if (eachConfig.emptyContent.length <= 0) return;

            const [nodeStart, nodeEnd] = createStartEndNode('each-block');

            currentNode.parentNode.insertBefore(nodeStart, currentNode.nextSibling);
            nodeStart.parentNode.insertBefore(nodeEnd, nodeStart.nextSibling);

            onUnmountSet.add(() => {
                let node = nodeStart;

                while (node && node !== nodeEnd) {
                    const next = node.nextSibling;
                    node.remove();
                    node = next;
                }

                nodeEnd.remove();
            })

            onUnmountQueue.push(onUnmountSet);
            onMountQueue.push(onMountSet);

            const eamptyBlock = createFragment(eachConfig.emptyContent, ctx);
            nodeEnd.before(eamptyBlock);

            onMountQueue.pop();
            onUnmountQueue.pop();

            if (core_context.is_mounted_to_the_DOM) return mount();

            core_context.onMountSet.add(mount)
            core_context.onUnmountSet.add(unmount)
            return;
        }

        isEmptyBlockMounted = false;
        unmount();

        if (renderedBlocks.length <= 0) {
            for (let index = 0; index < blockDatas.length; index++) {
                const block = createEachBlock(eachConfig, blockDatas, index, ctx, currentNode);
                renderedBlocks.push(block);
                currentNode = block.nodeEnd;
            }
            return;
        }

        for (let index = 0; index < blockDatas.length; index++) {

            let block = renderedBlocks[index];

            // USE EXISTING BLOCK
            if (block) {
                // IF THE SAME, RE-USE
                if (block.value === blockDatas[index]) {
                    currentNode = block.nodeEnd;
                    newRenderedBlocks.push(block);
                    continue;
                }

                // IF NOT, UPDATE VALUE AND RE-USE
                if (block.value !== blockDatas[index]) block.value = blockDatas[index];
                if (block.index.value !== index) block.index.value = index;

                currentNode = block.nodeEnd;
                newRenderedBlocks.push(block);
                continue;
            }

            // CREATE NEW BLOCK IF NOT EXISTS
            block = createEachBlock(eachConfig, blockDatas, index, ctx, currentNode);
            newRenderedBlocks.push(block);
            currentNode = block.nodeEnd;
        }

        // REMOVE UNUSED EACH BLOCKS
        for (let i = newRenderedBlocks.length; i < renderedBlocks.length; i++) {
            const renderBlock = renderedBlocks[i];

            let node = renderBlock.nodeStart;
            let nodeEnd = renderBlock.nodeEnd;

            while (node && node !== nodeEnd) {
                const next = node.nextSibling;
                node.remove();
                node = next;
            }

            nodeEnd.remove();
            renderBlock.unmount();
        }

        renderedBlocks = newRenderedBlocks;

        return;
    })
}

function effectTextInterpolation(node, process, ctx) {
    effect(() => {
        node.textContent = process.full_expr.replace(process.match, () => evaluate(process.expr, ctx));
    })
}

function effectAttributeInterpolation(node, process, ctx) {
    effect(() => {
        node.setAttribute(process.attr_name, process.attr.replace(process.match, () => evaluate(process.expr, ctx)));
    })
}

function effectEventListener(node, process, ctx) {
    effect(() => {
        const func = evaluate(process.expr, ctx);
        event_delegation.addListener(process.event_type, node, func);
        return () => event_delegation.removeListener(process.event_type, node, func);
    })
}

function effectDirectiveUse(node, process, ctx) {
    const func = ctx[process.func_name];
    if (!func) throw new Error(`use: directive "${process.func_name}" not found.`);

    const onUnmountSet = onUnmountQueue[onUnmountQueue.length - 1];
    const onMountSet = onMountQueue[onMountQueue.length - 1];

    onMountSet.add(() => {
        const cleanup = func(node, process.func_attr ? evaluate(process.func_attr, ctx) : undefined);
        if (typeof cleanup === "function") onUnmountSet.add(cleanup);
    });
}

function effectDirectiveBind(node, process, ctx) {
    const binding = evaluate(`(value) => ${process.value} = value`, ctx);
    const eventListener = (event) => {
        const type = event.target.type;

        if (type === "date") {
            binding(new Date(event.target.value))
            return;
        }

        binding(event.target[attr])
    };

    event_delegation.addListener(process.event_type, node, eventListener);

    effect(() => {
        const type = node.type;
        if (type === "date") {
            const date = evaluate(process.value, ctx);
            if (!(date instanceof Date)) return;
            node.value = date.toISOString().split('T')[0];
            return;
        }
        node[process.input_type] = evaluate(process.value, ctx);
    })

    const unmountSet = onUnmountQueue[onUnmountQueue.length - 1];
    unmountSet.add(() => event_delegation.removeListener(process.matched_event_type, node, eventListener));
}
