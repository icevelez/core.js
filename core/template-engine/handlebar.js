import { createStartEndNode, makeId, evaluate, removeNodesBetween, newSetFunc, parseOuterBlocks } from "../helper-functions.js";
import { core_context, onMountQueue, onUnmountQueue, pushPopMountUnmountSet } from "../internal-core.js";
import { effect, untrackedEffect, State } from "../reactivity.js";

/**
* @type {Map<string, (startNode:Node, endNode:Node, ctx:any) => void>}
*/
const processedBlocks = new Map();

/**
* @type {Map<number, Record<string, Function>>}
*/
const imported_components = new Map();

/**
 * @type {Map<string, HTMLTemplateElement>}
 */
const childNodesCache = new Map();

/**
* @type {WeakMap<Node, ((node:Node, destinationNode:DocumentFragment, ctx:any, render_slot_callbackfn:Function) => void)[]>}
*/
const cacheNodeProcesses = new WeakMap();

if (window.__corejs__) {
    window.__corejs__.processedBlocks = processedBlocks;
    window.__corejs__.imported_components = imported_components;
    window.__corejs__.childNodesCache = childNodesCache;
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

    let template = processAllComponents(options.template, imported_components_id, processComponent);
    if (options.components) imported_components.set(imported_components_id, options.components);

    template = preprocessTemplates(template);

    return function (attrs, render_slot_callbackfn) {
        if (Context && Context.toString().substring(0, 5) !== "class") throw new Error("context is not a class instance");
        const ctx = !Context ? {} : new Context(attrs);
        return processTemplate(template, ctx, options.components, render_slot_callbackfn);
    }
}

/**
* @param {string} template
* @param {Record<string, any>} ctx
* @param {Function} render_slot_callbackfn
*/
function processTemplate(template, ctx, render_slot_callbackfn) {

    let childNodes = childNodesCache.get(template);

    if (!childNodes) {
        const templateElement = document.createElement("template");
        templateElement.innerHTML = template;
        childNodes = Array.from(templateElement.content.childNodes);
        for (const childNode of childNodes) {
            preprocessNode(childNode);
        }
        childNodesCache.set(template, childNodes);
    }

    const fragment = document.createDocumentFragment();

    for (const childNode of childNodes) {
        const processes = cacheNodeProcesses.get(childNode) || [];
        processNode(processes, childNode.cloneNode(), Array.from(childNode.childNodes), fragment, ctx, render_slot_callbackfn);
    }

    return fragment;
}

/**
*
* @param {Node} node
* @param {DocumentFragment} destinationNode
* @param {Record<string, any>} ctx
* @param {Function} render_slot_callbackfn
*/
function preprocessNode(node) {
    const isText = node.nodeType === Node.TEXT_NODE;

    /**
    * @type {((node:Node, destinationNode:DocumentFragment, ctx:any, render_slot_callbackfn:Function) => void)[]}
    */
    const processes = [];

    if (isText) {
        const expression = node.textContent;
        const regex = /{{\s*([^#\/][^}]*)\s*}}/g;
        const parts = expression.split(/({{[^}]+}})/g);
        const has_handlebars = parts.map(p => p.startsWith("{{")).filter(p => p === true).length > 0;

        if (!has_handlebars) {
            processes.push((node, destinationNode, _, _2) => {
                destinationNode.appendChild(node)
            });
            cacheNodeProcesses.set(node, processes);
            return;
        }

        if (parts.length <= 1) {

            processes.push((node, destinationNode, ctx, _) => {
                effect(() => {
                    node.textContent = expression.replace(regex, (_, expr) => evaluate(expr, ctx));
                })
                destinationNode.appendChild(node)
            });

            cacheNodeProcesses.set(node, processes);
            return;
        }

        processes.push((node, destinationNode, ctx, _) => {
            node.textContent = "";

            for (const part of parts) {

                const textNode = document.createTextNode("");
                effect(() => {
                    textNode.textContent = part.replace(regex, (_, expr) => evaluate(expr, ctx));
                })
                destinationNode.append(textNode)
            };

            node.remove();
        });

        cacheNodeProcesses.set(node, processes);
        return;
    }

    if (node.nodeType === Node.COMMENT_NODE) {
        processes.push((node, destinationNode, _, _2) => {
            destinationNode.appendChild(node);
        });
        cacheNodeProcesses.set(node, processes);
        return;
    }

    const isSlotNode = (node) => Boolean(node.dataset.directive === "slot");
    const isCoreComponentNode = (node) => Boolean(node.dataset.directive === "core-component");
    const isMarkedNode = (node) => Boolean(node.dataset.directive && node.dataset.markerId)

    if (isSlotNode(node)) {
        processes.push((node, destinationNode, _, render_slot_callbackfn) => {
            node.remove();
            if (!render_slot_callbackfn) return;
            destinationNode.append(render_slot_callbackfn());
        });
        cacheNodeProcesses.set(node, processes);
        return;
    }

    if (isCoreComponentNode(node)) {
        processes.push((node, destinationNode, ctx, _) => {
            node.remove();
            const componentName = node.getAttribute("default");
            const component = ctx[componentName]?.default;
            node.removeAttribute("default");
            node.removeAttribute("data-directive");

            if (!component) {
                console.error(`Core component "${componentName}" is undefined. Kindly check if the component has a default export`);
                return;
            }

            const attrs = {};

            for (const attr of node.attributes) {
                const attrName = attr.name;
                const attrValue = attr.value;
                attrs[attrName] = attrValue && attrValue.startsWith("{{") ? evaluate(attrValue.match(/^{{\s*(.+?)\s*}}$/)[1], ctx) : attrValue;
            }

            const content = node.innerHTML;

            if (content) {
                const renderSlotCallbackfn = () => processTemplate(content, ctx);
                destinationNode.append(component(attrs, renderSlotCallbackfn));
            } else {
                destinationNode.append(component(attrs));
            }
        })
        cacheNodeProcesses.set(node, processes);
        return;
    }

    if (isMarkedNode(node)) {
        processes.push((node, destinationNode, ctx, _) => {
            const process_type = node.dataset.directive;
            const marker_id = node.dataset.markerId;

            const func = processedBlocks.get(marker_id);
            if (!func) throw new Error(`processed template type "${process_type}" with marker id "${marker_id}" does not exists`);

            const [nodeStart, nodeEnd] = createStartEndNode(process_type);
            const fragment = document.createDocumentFragment();

            fragment.append(nodeStart);
            fragment.append(nodeEnd);

            destinationNode.append(fragment);
            node.remove();

            func(nodeStart, nodeEnd, ctx);
        })
        cacheNodeProcesses.set(node, processes);
        return;
    }

    for (const attr of node.attributes) {
        const attrName = attr.name.toLowerCase();
        const attrValue = attr.value;

        if (attrName.startsWith('use:')) {
            processes.push((node, _, ctx, _2) => {
                const attr = attrName.slice(4);
                const func = evaluate(`${attr}`, ctx);
                const rawExpr = attrValue.match(/^{{\s*(.+?)\s*}}$/)[1];

                const onUnmountSet = onUnmountQueue[onUnmountQueue.length - 1];
                const onMountSet = onMountQueue[onMountQueue.length - 1];

                onMountSet.add(() => {
                    const cleanup = func(node, evaluate(rawExpr, ctx));
                    if (typeof cleanup === "function") onUnmountSet.add(cleanup);
                });

                node.removeAttribute(attr.name); // Clean up raw attribute
            })
            continue;
        }

        if (attrName.startsWith('bind:')) {
            processes.push((node, _, ctx, _2) => {
                const attr = attrName.slice(5);
                const type = node.type;
                const tagname = node.tagName;
                const eventDic = {
                    "checked": type === "date" ? "change" : "click",
                    "value": tagname === "select" ? "change" : "input",
                };

                const binding = evaluate(`(value) => ${attrValue} = value`, ctx);
                const eventListener = (event) => {
                    const type = event.target.type;

                    if (type === "date") {
                        binding(new Date(event.target.value))
                        return;
                    }

                    binding(event.target[attr])
                };

                const event = eventDic[attr] ? eventDic[attr] : attr;

                node.addEventListener(event, eventListener);

                effect(() => {
                    const type = node.type;

                    if (type === "date") {
                        const date = evaluate(attrValue, ctx);
                        if (!(date instanceof Date)) return;
                        node.value = date.toISOString().split('T')[0];
                        return;
                    }

                    node[attr] = evaluate(attrValue, ctx);
                })

                const unmountSet = onUnmountQueue[onUnmountQueue.length - 1];

                unmountSet.add(() => {
                    node.removeEventListener('click', eventListener)
                });

                node.removeAttribute(attrName); // Clean up raw attribute
            })
            continue;
        }

        if (!attrValue.includes('{{')) continue;

        if (attrName.startsWith('on')) {
            processes.push((node, _, ctx, _2) => {
                const rawExpr = attrValue.match(/^{{\s*(.+?)\s*}}$/)[1];

                node.removeAttribute(attr.name); // Clean up raw attribute

                effect(() => {
                    const func = evaluate(rawExpr, ctx);
                    node.addEventListener(attrName.slice(2), func);
                    return () => {
                        node.removeEventListener(attrName.slice(2), func);
                    }
                })
            })
            continue;
        }

        processes.push((node, _, ctx, _2) => {
            effect(() => {
                const newValue = attrValue.replace(/{{\s*(.+?)\s*}}/g, (_, expr) => evaluate(expr, ctx));
                node.setAttribute(attr.name, newValue);
            })
        })
    };

    for (const childNode of Array.from(node.childNodes)) {
        preprocessNode(childNode);
    }

    processes.push((node, destinationNode, _, _2) => {
        destinationNode.append(node);
    })

    cacheNodeProcesses.set(node, processes);
}

/**
*
* @param {((node:Node, destinationNode:DocumentFragment, ctx:any, render_slot_callbackfn:Function) => void)[]} processes
* @param {Node} node
* @param {DocumentFragment} destinationNode
* @param {Record<string, any>} ctx
* @param {Function} render_slot_callbackfn
*/
function processNode(processes, node, childNodes, destinationNode, ctx, render_slot_callbackfn) {
    for (const process of processes) {
        process(node, destinationNode, ctx, render_slot_callbackfn)
    }

    for (const childNode of childNodes) {
        const processes = cacheNodeProcesses.get(childNode) || [];
        processNode(processes, childNode.cloneNode(), Array.from(childNode.childNodes), node, ctx, render_slot_callbackfn);
    }
}

/**
* @param {string} eachBlock
* @returns {(startNode:Node, endNode:Node) => void}
*/
function processEachBlock(eachBlock) {
    const eachRegex = /{{#each\s+(.+?)\s+as\s+(\w+)(?:,\s*(\w+))?}}([\s\S]*?){{\/each}}/g;
    let eachConfig = { expression: "", mainContent: "", emptyContent: "", blockVar: "", indexVar: "" }

    eachBlock.replace(eachRegex, (_, expression, blockVar, indexVar, content) => {
        const [mainContent, emptyContent] = content.split(/{{:empty}}/);
        eachConfig = { expression, blockVar, indexVar, mainContent, emptyContent };
    });

    return function (startNode, _, ctx) {

        // THIS IS FOR EMPTY BLOCK

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
        * @type {{ nodeStart:Node, nodeEnd:Node, blockData:{ value : any }, index : State<number>, unmount:Function }}
        */
        let renderedBlocks = [];

        const discardUnusedBlocks = (newRenderedBlocks) => {
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
                renderBlock.index = null;
            }

            renderedBlocks = newRenderedBlocks;
        }

        let isEmptyBlockMounted = false;

        effect(() => {
            const newRenderedBlocks = [];

            let currentNode = startNode;

            const blockDatas = evaluate(eachConfig.expression, ctx) || [];

            if (blockDatas.length <= 0 && !isEmptyBlockMounted) {
                isEmptyBlockMounted = true;

                discardUnusedBlocks([]);

                if (!eachConfig.emptyContent) return;

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

                pushPopMountUnmountSet(onMountSet, onUnmountSet, () => {
                    const eamptyBlock = processTemplate(eachConfig.emptyContent, ctx);
                    nodeEnd.before(...eamptyBlock.childNodes);
                });

                if (core_context.is_mounted_to_the_DOM) {
                    mount();
                } else {
                    core_context.onMountSet.add(mount)
                    core_context.onUnmountSet.add(unmount)
                }

                currentNode = nodeEnd;
                return;
            }

            isEmptyBlockMounted = false;
            unmount();

            for (const index in blockDatas) {

                /**
                * @type {{ nodeStart:Node, nodeEnd:Node, blockData:{ value : any }, index : State<number>, unmount:Function }}
                */
                let block = renderedBlocks[index];

                // SKIP EXISTING BLOCK
                if (block && block.blockData.value === blockDatas[index]) {
                    currentNode = block.nodeEnd;
                    newRenderedBlocks.push(block);
                    continue;
                }

                // UPDATE EXISTING BLOCK IF NOT THE SAME
                if (block) {
                    if (block.blockData.value !== blockDatas[index]) block.blockData.value = blockDatas[index];
                    const i = parseInt(index);
                    if (block.index.value !== i) block.index.value = i;

                    currentNode = block.nodeEnd;
                    newRenderedBlocks.push(block);
                    continue;
                }

                // CREATE NEW BLOCK IF NOT EXISTS
                const blockData = {
                    get value() {
                        return blockDatas[index]
                    },
                    set value(new_value) {
                        blockDatas[index] = new_value;
                        return true;
                    }
                }

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

                block = { nodeStart, nodeEnd, blockData, index: new State(parseInt(index)), unmount };
                newRenderedBlocks.push(block);

                const childCtx = {
                    ...ctx,
                    [eachConfig.blockVar]: blockData,
                }

                if (eachConfig.indexVar) {
                    childCtx[eachConfig.indexVar] = { get value() { return block.index.value } };
                }

                cleanupEffect = untrackedEffect(() => {
                    unmount();
                    removeNodesBetween(nodeStart, nodeEnd);

                    pushPopMountUnmountSet(onMountSet, onUnmountSet, () => {
                        const mainBlock = processTemplate(eachConfig.mainContent, childCtx);
                        nodeEnd.before(...mainBlock.childNodes);
                    });

                    if (core_context.is_mounted_to_the_DOM) {
                        mount();
                    } else {
                        core_context.onMountSet.add(mount)
                        core_context.onUnmountSet.add(unmount)
                    }
                });

                currentNode = block.nodeEnd;
            }

            // REMOVE UNUSED EACH BLOCKS
            discardUnusedBlocks(newRenderedBlocks);
            return;
        })
    }
}

/**
* @param {string} ifBlock
* @returns {(startNode:Node, endNode:Node) => void}
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
                    block: firstBlock.substring(lastIndex, match.index)
                });
            }

            if (match[0].startsWith('{{:else if')) {
                firstCondition = match[1];
                lastIndex = match.index + match[0].length;
            } else if (match[0] === '{{:else}}') {
                segments.push({
                    condition: 'true', // Always true for else
                    block: firstBlock.substring(match.index + match[0].length)
                });
                lastIndex = firstBlock.length; // Done
            }
        }

        if (lastIndex < firstBlock.length) {
            segments.push({
                condition: firstCondition,
                block: firstBlock.substring(lastIndex)
            });
        }
    });

    return function (startNode, endNode, ctx) {
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

                pushPopMountUnmountSet(onMountSet, onUnmountSet, () => {
                    const fragment = document.createDocumentFragment();
                    const segmentBlock = processTemplate(condition.block, ctx);
                    fragment.appendChild(segmentBlock);
                    endNode.parentNode.insertBefore(fragment, endNode);
                })

                if (core_context.is_mounted_to_the_DOM) {
                    mount();
                } else {
                    core_context.onMountSet.add(mount)
                    core_context.onUnmountSet.add(unmount)
                }
            })
        })
    }
}

/**
* @param {string} awaitBlock
* @returns {(startNode:Node, endNode:Node) => void}
*/
function processAwaitBlock(awaitBlock) {
    const awaitRegex = /{{#await\s+(.+?)}}([\s\S]*?){{\/await}}/g;
    const thenRegex = /\{\{:then(?:\s+(\w+))?\}\}(.*?)(?={{:|$)/s;
    const catchRegex = /\{\{:catch(?:\s+(\w+))?\}\}(.*?)(?={{:|$)/s;
    const blockRegex = /{{:then[\s\S]*?}}|{{catch[\s\S]*?}}/;

    const awaitConfig = {
        promiseExpr: "",
        pendingContent: "",
        then: { match: false, var: null, expr: "", content: "", },
        catch: { match: false, var: null, expr: "", content: "", },
    }

    awaitBlock.replace(awaitRegex, (_, promiseExpr, block) => {
        awaitConfig.promiseExpr = promiseExpr;

        const thenMatch = block.match(thenRegex);
        if (thenMatch) {
            const [_, thenVar, thenContent] = thenMatch;
            awaitConfig.then = { match: true, var: thenVar, content: thenContent };
        }

        const catchMatch = block.match(catchRegex);
        if (catchMatch) {
            const [_, thenVar, thenContent] = thenMatch;
            awaitConfig.catch = { match: true, var: thenVar, content: thenContent };
        }

        const pendingContent = block.split(blockRegex)[0] || '';
        awaitConfig.pendingContent = pendingContent;
    });

    return function (startNode, endNode, ctx) {
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

            pushPopMountUnmountSet(onMountSet, onUnmountSet, () => {
                const pendingNodes = processTemplate(awaitConfig.pendingContent, ctx);
                endNode.before(...pendingNodes.childNodes);
            })

            mountInit();
        };

        const showThen = (result) => {
            unmount();
            removeNodesBetween(startNode, endNode);

            if (!awaitConfig.then.match) return;

            pushPopMountUnmountSet(onMountSet, onUnmountSet, () => {
                const childCtx = awaitConfig.then.var ? { ...ctx, [awaitConfig.then.var]: result } : ctx;
                const thenNodes = processTemplate(awaitConfig.then.content, childCtx);
                endNode.before(...thenNodes.childNodes);
            })

            mountInit();
        };

        const showCatch = (error) => {
            console.trace(error);

            unmount();
            removeNodesBetween(startNode, endNode);

            if (!awaitConfig.catch.match) return;

            pushPopMountUnmountSet(onMountSet, onUnmountSet, () => {
                const childCtx = awaitConfig.catch.var ? { ...ctx, [awaitConfig.catch.var]: result } : ctx;
                const catchNodes = processTemplate(awaitConfig.catch.content, childCtx);
                endNode.before(...catchNodes.childNodes);
            })

            mountInit();
        };

        effect(() => {
            try {
                const promise = evaluate(awaitConfig.promiseExpr, ctx);
                if (promise === undefined) return;

                if (promise instanceof Promise) {
                    showLoading();
                    promise.then(showThen).catch(showCatch);
                } else {
                    showThen(promise); // Support sync fallback
                }
            } catch (err) {
                showCatch(err);
            }
        })
    }
}

/**
* @param {{ import_id:number, tag : string, attrStr : string, slot_content : string | null }} component
*/
function processComponent(component) {
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

        if (component.slot_content) {
            const renderSlotCallbackfn = () => processTemplate(component.slot_content, ctx);
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
function preprocessTemplates(template) {

    template = processAllDirectiveBlocks(template, "await", processAwaitBlock);
    template = processAllDirectiveBlocks(template, "if", processIfBlock);
    template = processAllDirectiveBlocks(template, "each", processEachBlock);

    return template;
}

/**
* @param {string} template
* @param {string} directive
* @param {Function} processBlocks
*/
function processAllDirectiveBlocks(template, directive, processBlocks) {

    const openTag = `{{#${directive}`;
    const closeTag = `{{/${directive}}}`;
    const blocks = parseOuterBlocks(template, openTag, closeTag);

    for (const i in blocks) {
        const marker_id = `${directive}-${makeId(8)}`;

        template = template.replace(blocks[i], `<template data-directive="${directive}" data-marker-id="${marker_id}"></template>`)

        const start = blocks[i].match(new RegExp(`\\{\\{#${directive}\\s+([^\\}]+)\\}\\}`))[0];
        const end = blocks[i].lastIndexOf(`{{/${directive}}}`);
        const block = blocks[i].slice(0, end).replace(start, "");

        blocks[i] = start + preprocessTemplates(block) + `{{/${directive}}}`;

        processedBlocks.set(marker_id, processBlocks(blocks[i]));
    }

    return template;
}

/**
* @param {string} template
* @param {number} imported_components_id
* @param {Function} processComponent
*/
function processAllComponents(template, imported_components_id, processComponent) {
    const componentRegex = /<([A-Z][A-Za-z0-9]*)\s*((?:[^>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>(?:([\s\S]*?)<\/\1>)?/g;
    const directive = "component";

    template = template.replace(componentRegex, (match, tag, attrStr, _, slot_content) => {
        if (match.startsWith("<Core:slot")) return `<template data-directive="slot"></template>`;
        if (match.startsWith("<Core:component")) return `<template data-directive="core-component" ${attrStr.slice(10)}>${slot_content}</template>`;

        const marker_id = `${directive}-${makeId(8)}`;
        const component = { import_id: imported_components_id, tag, attrStr, slot_content };
        processedBlocks.set(marker_id, processComponent(component));
        return `<template data-import-id="${imported_components_id}" data-directive="${directive}" data-marker-id="${marker_id}"></template>`;
    })

    return template;
}
