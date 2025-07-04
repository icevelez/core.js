import { coreObj, onMountQueue, onUnmountQueue, scopedMountUnmountRun, copyContextQueue, setContextQueue } from "./internal-core.js";
import { effect, untrackedEffect, isSignal, makeFuncSignal, createSignal } from "./reactivity.js";
import { createStartEndNode, removeNodesBetween } from "./helper-functions.js";

const dev_mode_on = true;

/** @type {Map<string, WeakMap<Node, Set<Function>>>} */
const delegated_events = new Map();

/** @type {Map<string, Function>} */
const evaluationCache = new Map();

/** @type {Map<string, Node[]>} */
export const slotCache = new Map();

/** @type {Map<string, (startNode:Node, endNode:Node, ctx:any) => void>} */
export const markedNodeCache = new Map();

/** @type {Map<number, Record<string, Function>>} */
export const imported_components = new Map();

/** @type {WeakMap<Node, Node[]>} */
export const nodeChildren = new WeakMap();

/** @type {WeakMap<Node, ((node:Node, ctx:any, render_slot_callbackfn:(() => DocumentFragment)) => void)>} */
export const cacheNodeProcesses = new WeakMap();

if (dev_mode_on) window.__corejs__ = {
    version: "0.2.2",
    evaluationCache,
    markedNodeCache,
    slotCache,
    nodeChildren,
    imported_components,
    cacheNodeProcesses,
    delegated_events
}

export const componentObj = {
    /**
     * Used to keep track of components used in a tree and check for any circular dependency by finding if a component is already in the stack
     * @type {Set<number>}
     */
    stack: new Set(),
    id_counter: 1,
}

/**
* @param {string | HTMLTemplateElement} template
*/
export function createNodes(template) {
    /** @ype {HTMLTemplateElement} */
    let templateElement;

    if (template instanceof HTMLTemplateElement) {
        templateElement = template;
    } else {
        if (template == "") return document.createDocumentFragment();
        if (typeof template !== "string") throw new Error("template input is not a string");
        templateElement = document.createElement("template");
        templateElement.innerHTML = template;
    }

    const preprocessed_childNodes = Array.from(templateElement.content.childNodes);
    for (const childNode of preprocessed_childNodes) preprocessTextNodes(childNode);

    const childNodes = Array.from(templateElement.content.childNodes);
    const fragment = document.createDocumentFragment();

    for (const childNode of childNodes) fragment.append(childNode);

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
export function createFragment(fragment, ctx, render_slot_callbackfn) {
    const clone_fragment = fragment.cloneNode(true);

    const processes = cacheNodeProcesses.get(fragment);
    if (processes) applyProcess(clone_fragment, processes, ctx, render_slot_callbackfn);

    return clone_fragment;
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
* The purpose of this function is to search the dynamic bindings of a node and its children (recursively)
* and caching those bindings to be used when rendering to the DOM, skipping static nodes and attributes
* @param {Node} node
*/
function preprocessNode(node) {
    const isText = node.nodeType === Node.TEXT_NODE;

    /** @type {((node:Node, ctx:any, render_slot_callbackfn:Function) => void)[]} */
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

    const isSlotNode = (node) => Boolean(node.dataset && node.dataset.directive === "slot");
    const isCoreComponentNode = (node) => Boolean(node.dataset && node.dataset.directive === "core-component");
    const isMarkedNode = (node) => Boolean(node.dataset && node.dataset.directive && node.dataset.markerId)

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
        const payload = markedNodeCache.get(marker_id);
        if (!payload) throw new Error(`processed template type "${process_type}" with marker id "${marker_id}" does not exists`);
        processes.push({ type: process_type_enum.markedBlocks, marker_type, payload });
        return processes;
    }

    if (node.attributes) {
        for (const attr of node.attributes) {
            const attrName = attr.name.toLowerCase();
            const attrValue = attr.value;

            if (attrName.startsWith('use:')) {
                const match = attrValue.match(/^{{\s*(.+?)\s*}}$/);
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

                processes.push({ type: process_type_enum.directiveBind, event_type: matched_event_type, input_type, value: attrValue });
                node.removeAttribute(attrName);
            } else if (attrName.startsWith('on')) {
                const match = attrValue.match(/^{{\s*(.+?)\s*}}$/);
                const expr = !match ? "" : match[1];
                const event_type = attrName.slice(2);

                processes.push({ type: process_type_enum.eventListener, event_type, expr });
                node.removeAttribute(attrName);
            } else if (attrValue.includes('{{')) {
                let matches = [];
                let exprs = [];
                attrValue.replace(/{{\s*(.+?)\s*}}/g, (m, e) => { matches.push(m); exprs.push(e); });
                processes.push({ type: process_type_enum.attributeInterpolation, matches, exprs, attr_name: attrName, value: attrValue });
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

    // the `.reverse()` is important to keep node index in sync when applying the processes
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
                if (!render_slot_callbackfn) return;
                node.before(render_slot_callbackfn());
                node.remove();
                break;
            }
            case process_type_enum.coreComponent: {
                const component = ctx[process.component_name]?.default;

                if (!component) {
                    console.error(`Core component "${process.component_name}" is undefined. Check if the component has a default export`);
                    return;
                }

                const props = {};

                for (const attr of node.attributes) {
                    const attrName = attr.name;
                    const attrValue = attr.value;
                    props[attrName] = attrValue && attrValue.startsWith("{{") ? evaluate(attrValue.match(/^{{\s*(.+?)\s*}}$/)[1], ctx) : attrValue;
                }

                if (process.slot_nodes) {
                    const renderSlotCallbackfn = () => createFragment(process.slot_nodes, ctx);
                    node.before(component(props, renderSlotCallbackfn));
                } else {
                    node.before(component(props));
                }

                node.remove();
                break;
            }
            case process_type_enum.markedBlocks: {
                const [nodeStart, nodeEnd] = createStartEndNode(process.marker_type);
                const fragment = document.createDocumentFragment();
                fragment.append(nodeStart, nodeEnd);

                if (process.marker_type === "await") {
                    applyAwaitBlock(process.payload, nodeStart, nodeEnd, ctx);
                } else if (process.marker_type === "if") {
                    applyIfBlock(process.payload, nodeStart, nodeEnd, ctx);
                } else if (process.marker_type === "each") {
                    applyEachBlock(process.payload, nodeStart, nodeEnd, ctx)
                } else if (process.marker_type === "component") {
                    applyComponents(process.payload, nodeStart, nodeEnd, ctx);
                }

                node.before(fragment);
                node.remove();
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
 * @param {{ expression: string; mainContent: Node[]; emptyContent: Node[]; blockVars : []string, blockVar: string; indexVar: string; }} eachConfig
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

    const [nodeStart, nodeEnd] = createStartEndNode('each-block');

    currentNode.before(nodeStart);
    currentNode.before(nodeEnd);

    const blockData = createSignal(blockDatas[index]);
    const blockIndex = createSignal(index);

    const block = {
        nodeStart,
        nodeEnd,
        unmount,
        index: blockIndex,
        data: blockData,
    };

    let childCtx;

    if (eachConfig.blockVars.length > 0) {
        childCtx = {
            ...ctx,
            ...(eachConfig.blockVars.reduce((obj, key) => {
                obj[key] = makeFuncSignal(() => blockData()[key]);
                obj[key].set = (v) => blockData()[key] = v;
                obj[key].update = (fn) => blockData()[key] = fn(blockData[key])
                return obj;
            }, {})),
            ...(eachConfig.indexVar ? { [eachConfig.indexVar]() { return blockIndex() } } : {})
        };
    } else {
        childCtx = {
            ...ctx,
            [eachConfig.blockVar]: blockData,
            ...(eachConfig.indexVar ? { [eachConfig.indexVar]() { return blockIndex() } } : {})
        };
    }

    cleanupEffect = untrackedEffect(() => {
        const mainBlock = scopedMountUnmountRun(onMountSet, onUnmountSet, () => createFragment(eachConfig.mainContent, childCtx));
        nodeEnd.before(mainBlock);

        if (coreObj.is_mounted_to_the_DOM) {
            mount();
        } else {
            coreObj.onMountSet.add(mount)
            coreObj.onUnmountSet.add(unmount)
        }
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
        for (const renderBlock of renderedBlocks) {
            renderBlock.unmount();
        };
        renderedBlocks = [];
    };

    const parentOnUnmountSet = onUnmountQueue[onUnmountQueue.length - 1];
    if (parentOnUnmountSet && !parentOnUnmountSet.has(unmountEachBlock))
        parentOnUnmountSet.add(unmountEachBlock);

    /** @typedef {{ nodeStart:Node, nodeEnd:Node, data:{ ():any, set:(new_value:any) => void }, index : { ():number, set(new_index:number) => void }, unmount:Function }} EachBlock */

    /** @type {EachBlock[]} */
    let renderedBlocks = [];

    /** @type {Map<any, EachBlock>} */
    let renderedBlockMap = new Map();
    let isEmptyBlockMounted = false;

    effect(() => {
        let currentNode = endNode;

        /** @type {EachBlock[]} */
        const newRenderedBlocks = [];
        /** @type {any[]} */
        const blockDatas = evaluate(eachConfig.expression, ctx) || [];

        if (blockDatas.length <= 0 && !isEmptyBlockMounted) {
            isEmptyBlockMounted = true;

            if (renderedBlocks.length > 0) {
                for (let i = 0; i < renderedBlocks.length; i++) {
                    const block = renderedBlocks[i];
                    block.unmount();
                    block.index = null;
                }

                removeNodesBetween(startNode, endNode);
                renderedBlocks = [];
            }

            if (eachConfig.emptyContent.length <= 0) return;

            const [nodeStart, nodeEnd] = createStartEndNode('each-block');

            currentNode.before(nodeStart);
            currentNode.before(nodeEnd);

            const eamptyBlock = scopedMountUnmountRun(onMountSet, onUnmountSet, () => createFragment(eachConfig.emptyContent, ctx))
            nodeEnd.before(eamptyBlock);

            onUnmountSet.add(() => {
                removeNodesBetween(nodeStart, nodeEnd);
                nodeStart.remove();
                nodeEnd.remove();
            })

            if (coreObj.is_mounted_to_the_DOM) return mount();

            coreObj.onMountSet.add(mount)
            coreObj.onUnmountSet.add(unmount)
            return;
        }

        isEmptyBlockMounted = false;
        unmount();

        // CREATE NEW BLOCKS FROM SCRATCH
        if (renderedBlocks.length <= 0) {
            for (let index = 0; index < blockDatas.length; index++) {
                const block = createEachBlock(eachConfig, blockDatas, index, ctx, currentNode);
                renderedBlocks.push(block);
                renderedBlockMap.set(blockDatas[index], block);
                currentNode = block.nodeEnd.nextSibling;
            }
            return;
        }

        /** @type {Map<any, EachBlock>} */
        const newRenderedBlockMap = new Map();

        // FIND EXISTING BLOCK WITH THE SAME VALUE
        // UPDATE EXISTING BLOCK WITH NEW VALUE
        // CREATE NEW BLOCKS
        for (let index = 0; index < blockDatas.length; index++) {
            let block = renderedBlockMap.get(blockDatas[index]);
            let renderedBlock = renderedBlocks[index];

            if (block && block.data() === blockDatas[index]) {
                if (block.index() !== index) block.index.set(index);
                currentNode = block.nodeEnd.nextSibling;
                newRenderedBlocks.push(block);
                newRenderedBlockMap.set(blockDatas[index], block);
            } else if (renderedBlock) {
                renderedBlock.data.set(blockDatas[index]);
                currentNode = renderedBlock.nodeEnd.nextSibling;
                newRenderedBlocks.push(renderedBlock);
                newRenderedBlockMap.set(blockDatas[index], renderedBlock);
            } else {
                block = createEachBlock(eachConfig, blockDatas, index, ctx, currentNode);
                newRenderedBlocks.push(block);
                newRenderedBlockMap.set(blockDatas[index], block);
                currentNode = block.nodeEnd.nextSibling;
            }
        }

        // REMOVE UNUSED BLOCKS
        for (let i = 0; i < renderedBlocks.length; i++) {
            const renderBlock = renderedBlocks[i];
            if (newRenderedBlockMap.get(renderBlock.data())) continue;

            renderBlock.unmount();

            removeNodesBetween(renderBlock.nodeStart, renderBlock.nodeEnd);

            renderBlock.nodeStart.remove();
            renderBlock.nodeEnd.remove();
        }

        renderedBlockMap.clear();
        renderedBlockMap = newRenderedBlockMap;
        renderedBlocks = newRenderedBlocks;

        let previousNode = startNode;

        // RE-ORDER BLOCKS
        for (let i = 0; i < renderedBlocks.length; i++) {
            const renderBlock = renderedBlocks[i];

            if (renderBlock.nodeStart.previousSibling !== previousNode) {
                /** @type {EachBlock} */
                let nextRenderBlock;

                for (let j = i + 1; j < renderedBlocks.length; j++) {
                    nextRenderBlock = renderedBlocks[j];
                    if (nextRenderBlock.nodeStart.previousSibling !== previousNode) continue;
                    break;
                }

                const renderAnchor = nextRenderBlock.nodeEnd.nextSibling;
                const nextAnchor = renderBlock.nodeEnd.nextSibling;

                /** @type {Node} */
                let node;
                /** @type {Node} */
                let next;
                /** @type {DocumentFragment} */
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
 * @param {{ promiseExpr:string, pendingContent:Node[], then: { match:Boolean, var:string | null, content:Node[] }, catch: { match:Boolean, var:string | null, content:Node[] } }} awaitConfig
 * @param {Node} startNode
 * @param {Node} endNode
 * @param {any} ctx
 */
function applyAwaitBlock(awaitConfig, startNode, endNode, ctx) {
    /** @type {Set<Function>} */
    const onUnmountSet = new Set();
    /** @type {Set<Function>} */
    const onMountSet = new Set();

    const componentIdStackCopy = new Set(componentObj.stack);

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
        if (coreObj.is_mounted_to_the_DOM) {
            mount();
            return;
        }

        coreObj.onMountSet.add(mount);
        coreObj.onUnmountSet.add(unmount);
    }

    function showLoading() {
        unmount();
        removeNodesBetween(startNode, endNode);

        const nodes = scopedMountUnmountRun(onMountSet, onUnmountSet, () => createFragment(awaitConfig.pendingContent, ctx))
        endNode.before(nodes);

        mountInit();
    };

    const showThen = (result) => {
        unmount();
        removeNodesBetween(startNode, endNode);

        if (!awaitConfig.then.match) return;

        const originalComponentIdStack = componentObj.stack;
        componentObj.stack = componentIdStackCopy;

        const resetContextQueue = setContextQueue(contextQueue);
        const nodes = scopedMountUnmountRun(onMountSet, onUnmountSet, () => createFragment(awaitConfig.then.content, awaitConfig.then.var ? { ...ctx, [awaitConfig.then.var]: result } : ctx))
        resetContextQueue();
        componentObj.stack = originalComponentIdStack;

        endNode.before(nodes);

        mountInit();
    };

    const showCatch = (error) => {
        console.trace(error);

        unmount();
        removeNodesBetween(startNode, endNode);

        if (!awaitConfig.catch.match) return;

        const originalComponentIdStack = componentIdStack
        componentIdStack = componentIdStackCopy;

        const resetContextQueue = setContextQueue(contextQueue);
        const nodes = scopedMountUnmountRun(onMountSet, onUnmountSet, () => createFragment(awaitConfig.catch.content, awaitConfig.catch.var ? { ...ctx, [awaitConfig.catch.var]: error } : ctx));
        resetContextQueue();
        componentIdStack = originalComponentIdStack;

        endNode.before(nodes);

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

    effect(() => {
        /** @type {{ block: string; condition: string; }} */
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

            const segmentBlock = scopedMountUnmountRun(onMountSet, onUnmountSet, () => createFragment(condition.block, ctx))
            endNode.before(segmentBlock);

            if (coreObj.is_mounted_to_the_DOM) return mount();

            coreObj.onMountSet.add(mount)
            coreObj.onUnmountSet.add(unmount)
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

    /** @type {{ [key:string] : any }} */
    const props = {};
    const regex = /([:@\w-]+)(?:\s*=\s*"([^"]*)")?/g;

    /** @type {RegExpExecArray | null} */
    let match;

    while ((match = regex.exec(component.attrStr)) !== null) {
        const [_, key, value] = match;
        props[key] = value && value.startsWith('{{') ? evaluate(value.match(/^{{\s*(.+?)\s*}}$/)[1], ctx) : value;
    }

    let componentBlock;

    if (component.slot_node) {
        const renderSlotCallbackfn = () => createFragment(component.slot_node, ctx);
        componentBlock = componentFunc(props, renderSlotCallbackfn)
    } else {
        componentBlock = componentFunc(props);
    }

    endNode.before(componentBlock);
}

/**
 * @param {Node} node
 * @param {{ expr : string }} process
 * @param {any} ctx
 */
function applyTextInterpolation(node, process, ctx) {
    let prevContent;
    effect(() => {
        const textContent = evaluate(process.expr, ctx);
        if (prevContent === textContent) return;
        node.textContent = prevContent = textContent;
    })
}

/**
 * @param {Node} node
 * @param {{ value : string, matches : string[], exprs : string[], attr_name : string }} process
 * @param {any} ctx
 */
function applyAttributeInterpolation(node, process, ctx) {
    let prevAttr;
    effect(() => {
        let new_attr = process.value;
        for (let i = 0; i < process.matches.length; i++) new_attr = new_attr.replace(process.matches[i], evaluate(process.exprs[i], ctx));
        if (prevAttr === new_attr) return;
        node.setAttribute(process.attr_name, new_attr);
    })
}

/**
 * @param {Node} node
 * @param {{ expr : string, event_type : string }} process
 * @param {any} ctx
 */
function applyEventListener(node, process, ctx) {
    effect(() => {
        const func = evaluate(process.expr, ctx);
        return coreEventListener.add(process.event_type, node, func);
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

    onMountSet.add(() => {
        const cleanup = func(node, process.func_attr ? evaluate(process.func_attr, ctx) : undefined);
        if (typeof cleanup === "function") onUnmountSet.add(cleanup);
    });
}

/**
 * @param {Node} node
 * @param {{ value:string, input_type: string, event_type: string }} process
 * @param {any} ctx
 */
function applyDirectiveBind(node, process, ctx) {
    const binding = evaluate(`(v, c) => { (c(${process.value})) ? ${process.value}.set(v) : ${process.value} = v; }`, ctx);

    const eventListener = (event) => {
        const type = event.target.type;
        if (type === "date") return binding(new Date(event.target[process.input_type]), isSignal)
        return binding(event.target[process.input_type], isSignal)
    };

    const remove_listener = coreEventListener.add(process.event_type, node, eventListener);
    const unmountSet = onUnmountQueue[onUnmountQueue.length - 1];
    unmountSet.add(remove_listener);

    effect(() => {
        let value = evaluate(process.value, ctx);
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

/**
 * NOTE: this will create a single global listener but that global listener will stay persistent through out the app life-cycle,
 * it will not be dispose of even if there are no node listener because it's using a `WeakMap`
 * there's no way of knowing if there's zero nodes listening, so there's no way of disposing the global listener
 *
 * I want to dispose the global listener if there's zero nodes listening but there's no way of doing that so that's the drawback for now
 * until I come up with another solution
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
