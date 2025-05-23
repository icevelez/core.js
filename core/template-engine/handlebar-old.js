import { effect, State, untrackedEffect } from "../reactivity.js";
import { evaluate, makeId, removeNodesBetween, startEndTextNode, newSetFunc } from "../helper-functions.js";
import { onMountQueue, onUnmountQueue, core_context } from "../internal-core.js"

/**
* @param {{ template : string, components : { [key:string] : Function } }} options
* @param {any} Context anonymous class that encapsulate logic
* @returns {(props?:Record<string, any>) => DocumentFragment}
*/
export function component(options, Context = null) {
    return function (attrs = {}, slot_callback_fn = null) {
        if (Context && Context.toString().substring(0, 5) !== "class") throw new Error("context is not a class instance");

        onUnmountQueue.push(new Set());
        onMountQueue.push(new Set());

        const ctx = !Context ? {} : new Context(attrs);

        const template = processTemplate(options.template, ctx, options.components, slot_callback_fn);

        const unmountSet = onUnmountQueue.pop();
        const mountSet = onMountQueue.pop();

        onUnmountQueue.push(unmountSet);
        onMountQueue.push(mountSet);

        return template;
    };
}

/**
* @param {string} template
* @param {any} ctx
* @param {{ [key:string] : Function }} components
* @param {() => DocumentFragment} slot_callback_fn
*/
function processTemplate(template, ctx, components = {}, slot_callback_fn = null) {

    // holds callback function to convert marked element to its dynamic content
    const processedMaps = {
        if: new Map(),
        each: new Map(),
        await: new Map(),
        component: new Map()
    };

    let slotMarkerId;

    if (slot_callback_fn) {
        template = template.replace(/<Slot\s*\/>/g, () => {
            slotMarkerId = makeId(24);
            return `<div id="${slotMarkerId}"></div>`;
        });
    }

    template = processIf(processedMaps.if, template, ctx, components);
    template = processEach(processedMaps.each, template, ctx, components);
    template = processAwait(processedMaps.await, template, ctx, components);
    template = processComponents(processedMaps.component, template, ctx, components);

    const div = document.createElement('div');
    div.innerHTML = template;

    if (slotMarkerId) {
        const markerElement = div.querySelector(`#${slotMarkerId}`);
        const [textNodeStart, textNodeEnd] = startEndTextNode('slot');

        markerElement.replaceWith(textNodeEnd);
        textNodeEnd.parentElement.insertBefore(textNodeStart, textNodeEnd);
        textNodeEnd.parentNode.insertBefore(slot_callback_fn(), textNodeEnd);
    }

    for (const [key, map] of Object.entries(processedMaps)) {
        map.forEach((func, marker_key) => {
            const markerElement = div.querySelector(`#${marker_key}`);
            const [textNodeStart, textNodeEnd] = startEndTextNode(key);

            markerElement.replaceWith(textNodeEnd);
            textNodeEnd.parentElement.insertBefore(textNodeStart, textNodeEnd);

            func(textNodeStart, textNodeEnd)();
        })
    }

    const fragment = document.createDocumentFragment();

    for (const node of Array.from(div.childNodes)) {
        processNode(node, ctx, fragment)
    };

    return fragment;
}

/**
*
* @param {HTMLElement} node
* @param {any} ctx
* @param {DocumentFragment} parentNode
*/
function processNode(node, ctx, parentNode) {

    if (node.nodeType === Node.TEXT_NODE) {
        const expression = node.textContent;
        const regex = /{{\s*([^#\/][^}]*)\s*}}/g;
        const parts = expression.split(/({{[^}]+}})/g);

        if (parts.length <= 1) {

            effect(() => {
                node.textContent = expression.replace(regex, (_, expr) => evaluate(expr, ctx));
            });

            parentNode.appendChild(node)
            return;
        }

        node.textContent = "";

        for (const part of parts) {
            const cloneNode = node.cloneNode();

            effect(() => {
                cloneNode.textContent = part.replace(regex, (_, expr) => evaluate(expr, ctx));
            });

            parentNode.append(cloneNode)
        };

        node.parentElement.removeChild(node);

        return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
        for (const attr of node.attributes) {
            const attrName = attr.name.toLowerCase();
            const attrValue = attr.value;

            if (attrName.startsWith('use:')) {
                const attr = attrName.slice(4);
                const func = evaluate(`${attr}`, ctx);
                const rawExpr = attrValue.match(/^{{\s*(.+?)\s*}}$/)[1];

                const unmountSet = onUnmountQueue[onUnmountQueue.length - 1];
                const onMountSet = onMountQueue[onMountQueue.length - 1];
                onMountSet.add(() => {
                    const cleanup = func(node, evaluate(rawExpr, ctx));
                    if (typeof cleanup === "function") unmountSet.add(cleanup);
                });

                node.removeAttribute(attrName); // Clean up raw attribute
                continue;
            }

            if (attrName.startsWith('bind:')) {
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

                node.addEventListener(eventDic[attr] ? eventDic[attr] : attr, eventListener);

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
                continue;
            }

            if (!attr.value.includes('{{')) continue;

            if (attrName.startsWith('on')) {

                const rawExpr = attrValue.match(/^{{\s*(.+?)\s*}}$/)[1];

                node.removeAttribute(attr.name); // Clean up raw attribute

                effect(() => {
                    const func = evaluate(rawExpr, ctx);
                    node.removeEventListener(attrName.slice(2), func);
                    node.addEventListener(attrName.slice(2), func);
                })

                continue;
            }

            effect(() => {
                const newValue = attrValue.replace(/{{\s*(.+?)\s*}}/g, (_, expr) => evaluate(expr, ctx));
                node.setAttribute(attr.name, newValue);
            })
        };

        parentNode.appendChild(node);

        for (const child of Array.from(node.childNodes)) {
            processNode(child, ctx, node);
        };
        return;
    }

    if (node.nodeType === Node.COMMENT_NODE) {
        parentNode.appendChild(node);
    }
}

/**
* @param {Map<string, (startNode:Text, endNode:Text) => (() => void>} ifMap
* @param {string} template
* @param {any} ctx
* @param {Record<string, Function>} components
*/
function processIf(ifMap, template, ctx, components) {
    const ifRegex = /{{#if\s+(.+?)}}([\s\S]*?){{\/if}}/g;
    const ifElseregex = /{{else\s+if\s+(.+?)}}|{{else}}/g;
    return template.replace(ifRegex, (_, firstCondition, firstBlock) => {
        const markerId = `if-${makeId(24)}`;

        /**
        * @type {{ block : string, condition : string }[]}
        */
        const segments = [];

        let lastIndex = 0;
        let match;

        while ((match = ifElseregex.exec(firstBlock)) !== null) {
            if (match.index > lastIndex) {
                segments.push({
                    condition: firstCondition,
                    block: firstBlock.substring(lastIndex, match.index)
                });
            }

            if (match[0].startsWith('{{else if')) {
                firstCondition = match[1];
                lastIndex = match.index + match[0].length;
            } else if (match[0] === '{{else}}') {
                segments.push({
                    condition: firstCondition,
                    block: firstBlock.substring(lastIndex, match.index)
                });
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

        ifMap.set(markerId, (startNode, endNode) => {
            return () => {
                const unMountSet = newSetFunc();
                const mountSet = newSetFunc();

                const unmount = () => {
                    for (const unmount of unMountSet) unmount();
                    unMountSet.clear();
                };

                const mount = () => {
                    for (const mount of mountSet) mount();
                    mountSet.clear();
                }

                effect(() => {
                    unmount();
                    removeNodesBetween(startNode, endNode);

                    for (const segment of segments) {
                        if (evaluate(segment.condition, ctx)) {

                            const fragment = document.createDocumentFragment();

                            onUnmountQueue.push(unMountSet);
                            onMountQueue.push(mountSet);

                            fragment.appendChild(processTemplate(segment.block, ctx, components));

                            onUnmountQueue.pop();
                            onMountQueue.pop();

                            endNode.parentNode.insertBefore(fragment, endNode);

                            (core_context.mounted) ? mount() : core_context.mounts.add(mount);

                            const parentUnmount = onUnmountQueue[onUnmountQueue.length - 1];
                            if (parentUnmount && !parentUnmount.has(unmount)) parentUnmount.add(unmount);

                            break;
                        }
                    }
                })
            }
        });

        return `<div id="${markerId}"></div>`;
    });
}

/**
* @param {Map<string, (startNode:Text, endNode:Text) => (() => void>} eachMap
* @param {string} template
* @param {any} ctx
* @param {Record<string, Function>} components
*/
function processEach(eachMap, template, ctx, components) {
    const eachRegex = /{{#each\s+(.+?)\s+as\s+(\w+)(?:,\s*(\w+))?}}([\s\S]*?){{\/each}}/g;
    return template.replace(eachRegex, (_, listExpr, itemName, indexName, block) => {
        const markerId = `each-${makeId(24)}`;

        eachMap.set(markerId, (startMarker, _) => (() => {
            const [mainBlock, elseBlock] = block.split(/{{empty}}/);

            /**
            * @type {RenderItem[]}
            */
            let renderedItems = [];

            const unmountEach = () => {
                for (const r of renderedItems) {
                    r.unmount();
                    r.deleteItself();
                };
                renderedItems = [];
            };

            const parentUnmount = onUnmountQueue[onUnmountQueue.length - 1];
            if (parentUnmount && !parentUnmount.has(unmountEach)) parentUnmount.add(unmountEach);

            /**
            * @param {RenderItem[]} newRenderedItems
            */
            const removeUnusedItems = (newRenderedItems) => {
                for (const i in renderedItems) {
                    const r = renderedItems[i];
                    const existingItemIndex = newRenderedItems.findIndex((x) => x === r);
                    if (existingItemIndex > -1) {
                        if (existingItemIndex === i) continue;
                        if (r.index) r.index.value = existingItemIndex;
                        continue;
                    }

                    let node = r.blockStart;
                    let end = r.blockEnd;

                    while (node && node !== r.blockEnd) {
                        const next = node.nextSibling;
                        node.remove();
                        node = next;
                    }

                    r.unmount();
                    r.deleteItself();

                    end.remove();
                };

                renderedItems = newRenderedItems;
            }

            effect(() => {
                let currentMarker = startMarker;
                let newRenderedItems = [];

                const list = evaluate(listExpr, ctx) || [];

                if (list.length > 0) {
                    for (const index in list) {
                        const item = list[index];
                        const existingIndex = renderedItems.findIndex((r) => r.item === item);
                        let existing = renderedItems[existingIndex];

                        const unMountSet = newSetFunc();
                        const mountSet = newSetFunc();

                        /**
                        * @type {Function}
                        */
                        let cleanup;

                        const unmount = () => {
                            if (cleanup) cleanup();
                            for (const unmount of unMountSet) unmount();
                            unMountSet.clear();
                        };

                        const mount = () => {
                            for (const mount of mountSet) mount();
                            mountSet.clear();
                        }

                        if (!existing) {
                            const [blockStart, blockEnd] = startEndTextNode();

                            currentMarker.parentElement.insertBefore(blockStart, currentMarker.nextSibling);
                            currentMarker.parentElement.insertBefore(blockEnd, blockStart.nextSibling);

                            existing = new RenderItem(new State(parseInt(index)), item, blockStart, blockEnd, unmount);

                            const childCtx = { ...ctx, [itemName]: item };

                            if (indexName) {
                                childCtx[indexName] = {
                                    get value() {
                                        return existing.index.value;
                                    }
                                };
                            }

                            let node = blockStart.nextSibling;
                            while (node && node !== blockEnd) {
                                const next = node.nextSibling;
                                node.remove();
                                node = next;
                            }

                            cleanup = untrackedEffect(() => {

                                unmount();
                                removeNodesBetween(blockStart, blockEnd);

                                onUnmountQueue.push(unMountSet);
                                onMountQueue.push(mountSet);

                                const mainBlockContent = processTemplate(mainBlock, childCtx, components);

                                onUnmountQueue.pop();
                                onMountQueue.pop();

                                blockEnd.before(...mainBlockContent.childNodes);
                                (core_context.mounted) ? mount() : core_context.mounts.add(mount);

                            })
                        }

                        newRenderedItems.push(existing);
                        currentMarker = existing.blockEnd;
                    };
                    removeUnusedItems(newRenderedItems);
                    return;
                }

                if (!elseBlock) return

                const [blockStart, blockEnd] = startEndTextNode();

                const unMountSet = newSetFunc();
                const mountSet = newSetFunc();

                const unmount = () => {
                    for (const unmount of unMountSet) unmount();
                    unMountSet.clear();
                };

                const mount = () => {
                    for (const mount of mountSet) mount();
                    mountSet.clear();
                }

                currentMarker.parentElement.insertBefore(blockStart, currentMarker.nextSibling);
                blockStart.parentElement.insertBefore(blockEnd, blockStart.nextSibling);

                const existing = new RenderItem(null, null, blockStart, blockEnd, unmount)

                onUnmountQueue.push(unMountSet);
                onMountQueue.push(mountSet);

                const elseContent = processTemplate(elseBlock, ctx, components);

                onUnmountQueue.pop();
                onMountQueue.pop();

                blockEnd.before(...elseContent.childNodes);
                (core_context.mounted) ? mount() : core_context.mounts.add(mount);

                currentMarker = existing.blockEnd;

                newRenderedItems.push(existing);

                removeUnusedItems(newRenderedItems);
            });
        }));

        return `<div id="${markerId}"></div>`;
    });
}

/**
* @param {Map<string, (startNode:Text, endNode:Text) => (() => void>} awaitMap
* @param {string} template
* @param {any} ctx
* @param {Record<string, Function>} components
*/
function processAwait(awaitMap, template, ctx, components) {
    const awaitRegex = /{{#await\s+(.+?)}}([\s\S]*?){{\/await}}/g;
    const thenRegex = /{{then\s+(\w+)}}([\s\S]*?)(?={{:|$)/;
    const catchRegex = /{{catch\s+(\w+)}}([\s\S]*?)(?={{:|$)/;
    const blockRegex = /{{then[\s\S]*?}}|{{catch[\s\S]*?}}/;
    return template.replace(awaitRegex, (_, promiseExpr, block) => {
        /**
        * @type {string[]}
        */
        const thenMatch = block.match(thenRegex);
        /**
        * @type {string[]}
        */
        const catchMatch = block.match(catchRegex);
        /**
        * @type {string}
        */
        const loadingContent = block.split(blockRegex)[0] || '';

        const markerId = `await-${makeId(24)}`;

        awaitMap.set(markerId, (markerStart, markerEnd) => {
            return () => {
                let unMountSet = newSetFunc();
                let mountSet = newSetFunc();

                const unmount = () => {
                    for (const unmount of unMountSet) unmount();
                    unMountSet.clear();
                };

                const mount = () => {
                    for (const mount of mountSet) mount();
                    mountSet.clear();
                }

                const clearContent = () => {
                    unmount();
                    let node = markerStart.nextSibling;
                    while (node && node !== markerEnd) {
                        const next = node.nextSibling;
                        node.remove();
                        node = next;
                    }
                };

                const showLoading = () => {
                    clearContent();

                    onUnmountQueue.push(unMountSet);
                    onMountQueue.push(mountSet);

                    const loadingNodes = processTemplate(loadingContent, ctx, components);

                    onUnmountQueue.pop();
                    onMountQueue.pop();

                    markerEnd.before(...loadingNodes.childNodes);
                    (core_context.mounted) ? mount() : core_context.mounts.add(mount);
                };

                const showThen = (result) => {
                    clearContent();
                    if (!thenMatch) return;
                    const [_, varName, thenBlock] = thenMatch;

                    onUnmountQueue.push(unMountSet);
                    onMountQueue.push(mountSet);

                    const thenNodes = processTemplate(thenBlock, { ...ctx, [varName]: result }, components);

                    onUnmountQueue.pop();
                    onMountQueue.pop();

                    markerEnd.before(...thenNodes.childNodes);
                    (core_context.mounted) ? mount() : core_context.mounts.add(mount);
                };

                const showCatch = (error) => {
                    console.error(error);

                    clearContent();
                    if (!catchMatch) return;
                    const [_, varName, catchBlock] = catchMatch;

                    onUnmountQueue.push(unMountSet);
                    onMountQueue.push(mountSet);

                    const catchNodes = processTemplate(catchBlock, { ...ctx, [varName]: error }, components);

                    onUnmountQueue.pop();
                    onMountQueue.pop();

                    markerEnd.before(...catchNodes.childNodes);
                    (core_context.mounted) ? mount() : core_context.mounts.add(mount);
                };

                effect(() => {
                    try {
                        const promise = evaluate(promiseExpr, ctx);

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
        });

        return `<div id="${markerId}"></div>`;
    });
}

/**
* @param {Map<string, (startNode:Text, endNode:Text) => (() => void>} componentMap
* @param {string} template
* @param {any} ctx
* @param {Record<string, Function>} components
*/
function processComponents(componentMap, template, ctx, components) {

    const componentRegex = /<([A-Z][A-Za-z0-9]*)\s*((?:[^>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>(?:([\s\S]*?)<\/\1>)?/g;

    function parseAttributes(attrString, ctx) {
        const attrs = {};
        const regex = /([:@\w-]+)(?:\s*=\s*"([^"]*)")?/g;
        let match;

        while ((match = regex.exec(attrString)) !== null) {
            const [, key, value] = match;
            attrs[key] = value.startsWith('{{') ? evaluate(value.match(/^{{\s*(.+?)\s*}}$/)[1], ctx) : value;
        }

        return attrs;
    }

    return template.replace(componentRegex, (match, tag, attrStr, _, inner_content) => {
        if (tag === "Component") {
            const attrs = parseAttributes(attrStr, ctx);
            const markerId = `component-${makeId(24)}`;

            const componentCallbackfn = (attrs.default) ? attrs.default.default : null;
            delete attrs.default;

            componentMap.set(markerId, (startNode, endNode) => {
                if (!componentCallbackfn) return () => { };

                let unMountSet = newSetFunc();
                let mountSet = newSetFunc();

                const unmount = () => {
                    for (const unmount of unMountSet) unmount();
                    unMountSet.clear();
                };

                const mount = () => {
                    for (const mount of mountSet) mount();
                    mountSet.clear();
                }

                const renderSlotCallbackfn = () => processTemplate(inner_content, ctx, components);

                return () => {
                    unmount();
                    removeNodesBetween(startNode, endNode);

                    const component = inner_content ? componentCallbackfn(attrs, renderSlotCallbackfn) : componentCallbackfn(attrs);

                    unMountSet = onUnmountQueue.pop();
                    mountSet = onMountQueue.pop();

                    endNode.parentElement.insertBefore(component, endNode);
                    (core_context.mounted) ? mount() : core_context.mounts.add(mount);

                    const parentUnmount = onUnmountQueue[onUnmountQueue.length - 1];
                    if (parentUnmount && !parentUnmount.has(unmount)) parentUnmount.add(unmount);
                }
            })

            return `<div id="${markerId}"></div>`;
        }

        if (tag === "Slot" && !inner_content) return '';
        if (!components[tag]) throw new Error(`could not load component <${tag}/>. component not found`);

        const attrs = parseAttributes(attrStr, ctx);
        const markerId = `component-${makeId(24)}`;

        componentMap.set(markerId, (startNode, endNode) => {
            let unMountSet = newSetFunc();
            let mountSet = newSetFunc();

            const unmount = () => {
                for (const unmount of unMountSet) unmount();
                unMountSet.clear();
            };

            const mount = () => {
                for (const mount of mountSet) mount();
                mountSet.clear();
            }

            const renderSlotCallbackfn = () => processTemplate(inner_content, ctx, components);

            return () => {
                unmount();
                removeNodesBetween(startNode, endNode);

                const component = inner_content ? components[tag](attrs, renderSlotCallbackfn) : components[tag](attrs);

                unMountSet = onUnmountQueue.pop();
                mountSet = onMountQueue.pop();

                endNode.parentElement.insertBefore(component, endNode);
                (core_context.mounted) ? mount() : core_context.mounts.add(mount);

                const parentUnmount = onUnmountQueue[onUnmountQueue.length - 1];
                if (parentUnmount && !parentUnmount.has(unmount)) parentUnmount.add(unmount);
            }
        })

        return `<div id="${markerId}"></div>`;
    });
}

// ==================================================== //

/**
* This class is used in `{{#each}}`
*/
class RenderItem {

    /**
    * @type {State<number> | undefined}
    */
    index;

    /**
    * @type {any}
    */
    item;

    /**
    * @type {Function}
    */
    unmount;

    /**
    * @type {Text}
    */
    blockStart;
    /**
    * @type {Text}
    */
    blockEnd;

    constructor(index, item, blockStart, blockEnd, unmount) {
        this.index = index;
        this.item = item;
        this.blockStart = blockStart;
        this.blockEnd = blockEnd;
        this.unmount = unmount;
    }

    deleteItself = () => {
        this.blockEnd = this.blockStart = this.index = this.item = this.unmount = null;
    }
}
