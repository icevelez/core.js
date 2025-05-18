import { effect, State, untrackedEffect } from "../reactivity.js";
import { evaluate, makeId, removeNodesBetween, startEndTextNode } from "../helper-functions.js";
import { onMountQueue, onUnmountQueue } from "../internal-core.js"

/**
* @param {{ template : string, components : { [key:string] : Function } }} options
* @param {any} Context
* @param {() => DocumentFragment} slot
* @returns {(props?:Record<string, any>) => DocumentFragment}
*/
export function component(options, Context) {
    return function (attrs = {}, slot = null) {
        if (Context.toString().substring(0, 5) !== "class") throw new Error("context is not a class instance");

        onUnmountQueue.push(new Set());
        onMountQueue.push(new Set());

        const ctx = new Context(attrs, slot);

        const unmountSet = onUnmountQueue.pop();
        const mountSet = onMountQueue.pop();

        const template = processTemplate(options.template, ctx, options.components, slot);

        onUnmountQueue.push(unmountSet);
        onMountQueue.push(mountSet);

        return template;
    };
}

/**
* @param {string} template
* @param {any} ctx
* @param {{ [key:string] : Function }} components
* @param {() => DocumentFragment} slot
*/
function processTemplate(template, ctx, components = {}, slot = null) {

    // holds callback function to convert marked element to its dynamic content
    const processedMaps = {
        if: new Map(),
        each: new Map(),
        await: new Map(),
        component: new Map()
    };

    let slotMarkerId;

    if (slot) {
        slotMarkerId = makeId(24);
        template = template.replace(/<Slot\s*\/>/g, () => `<div id="${slotMarkerId}"></div>`);
    }

    const originalTemplate = template;

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
        textNodeEnd.parentNode.insertBefore(slot(), textNodeEnd);
    }

    Object.entries(processedMaps).forEach(([key, map]) => {
        map.forEach((func, marker_key) => {

            const markerElement = div.querySelector(`#${marker_key}`);
            const [textNodeStart, textNodeEnd] = startEndTextNode(key);

            markerElement.replaceWith(textNodeEnd);
            textNodeEnd.parentElement.insertBefore(textNodeStart, textNodeEnd);

            func(textNodeStart, textNodeEnd)();
        })
    })

    const fragment = document.createDocumentFragment();

    Array.from(div.childNodes).forEach(node => {
        processNode(node, ctx, fragment)
    });

    return fragment;
}

/**
*
* @param {HTMLElement} node
* @param {any} ctx
* @param {DocumentFragment} parentFragment
*/
function processNode(node, ctx, parentFragment) {

    if (node.nodeType === Node.TEXT_NODE) {

        // prevent reprocessing the same node
        if (node.__processed_text) {
            parentFragment.appendChild(node);
            return;
        }

        const expression = node.textContent;
        const regex = /{{\s*([^#\/][^}]*)\s*}}/g;
        const parts = expression.split(/({{[^}]+}})/g);

        if (parts.length <= 1) {

            node.__processed_text = true;

            effect(() => {
                node.textContent = expression.replace(regex, (_, expr) => evaluate(expr, ctx));
            });

            parentFragment.appendChild(node)
            return;
        }

        node.textContent = "";

        parts.forEach(part => {
            const cloneNode = node.cloneNode();
            cloneNode.__processed_text = true;

            effect(() => {
                cloneNode.textContent = part.replace(regex, (_, expr) => evaluate(expr, ctx));
                console.log("change", { text: cloneNode.textContent });
            });

            parentFragment.append(cloneNode)
        });

        node.parentElement.removeChild(node);


        return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
        // Process attributes with {{ }}
        Array.from(node.attributes).forEach(attr => {
            if (!attr.value.includes('{{')) return;

            const attrName = attr.name.toLowerCase();
            const attrValue = attr.value;

            // Check for event binding inside normal attributes
            if (attrName.startsWith('on')) {
                const rawExpr = attrValue.match(/^{{\s*(.+?)\s*}}$/)[1];

                effect(() => {
                    const func = evaluate(rawExpr, ctx);
                    node.removeEventListener(attrName.slice(2), func);
                    node.addEventListener(attrName.slice(2), func);
                })

                node.removeAttribute(attr.name); // Clean up raw attribute
                return;
            }

            effect(() => {
                const newValue = attrValue.replace(/{{\s*(.+?)\s*}}/g, (_, expr) => evaluate(expr, ctx));
                node.setAttribute(attr.name, newValue);
            })
        });

        parentFragment.appendChild(node);

        Array.from(node.childNodes).forEach(child => {
            processNode(child, ctx, node);
        });
        return;
    }

    if (node.nodeType === Node.COMMENT_NODE) {
        parentFragment.appendChild(node);
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
                const unMountSet = new Set();
                const mountSet = new Set();
                unMountSet.tag = "if";
                mountSet.tag = "if";

                const unmount = () => {
                    unMountSet.forEach((umount) => umount());
                    unMountSet.clear();
                };

                const mount = () => {
                    mountSet.forEach((mount) => mount());
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
                            mount();

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
            const parent = startMarker.parentNode;

            let renderedItems = [];

            const unmountEach = () => {
                renderedItems.forEach((r) => {
                    r.unmount();

                    if (r.index) {
                        r.index.deleteState();
                        delete r.index;
                    }

                    delete r.item;
                    delete r.blockStart;
                    delete r.blockEnd;
                    delete r.unmount;
                });
                renderedItems = [];
            };

            const parentUnmount = onUnmountQueue[onUnmountQueue.length - 1];
            if (parentUnmount && !parentUnmount.has(unmountEach)) parentUnmount.add(unmountEach);

            effect(() => {
                let currentMarker = startMarker;
                let newRenderedItems = [];

                const list = evaluate(listExpr, ctx) || [];

                if (list.length > 0) {
                    list.forEach((item, index) => {
                        const existingIndex = renderedItems.findIndex((r) => r.item === item);
                        let existing = renderedItems[existingIndex];

                        const unMountSet = new Set();
                        const mountSet = new Set();

                        let cleanup;

                        const unmount = () => {
                            if (cleanup) cleanup();
                            unMountSet.forEach((umount) => umount());
                            unMountSet.clear();
                        };

                        const mount = () => {
                            mountSet.forEach((mount) => mount());
                            mountSet.clear();
                        }

                        if (!existing) {
                            const [blockStart, blockEnd] = startEndTextNode();

                            parent.insertBefore(blockStart, currentMarker.nextSibling);
                            parent.insertBefore(blockEnd, blockStart.nextSibling);

                            existing = { item, blockStart, blockEnd, index: new State(index) };
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
                                console.log("RENDERING ITEM");

                                unmount();
                                removeNodesBetween(blockStart, blockEnd);

                                onUnmountQueue.push(unMountSet);
                                onMountQueue.push(mountSet);

                                const mainBlockContent = processTemplate(mainBlock, childCtx, components);

                                onUnmountQueue.pop();
                                onMountQueue.pop();

                                blockEnd.before(...mainBlockContent.childNodes);
                                mount();

                            })

                            existing.unmount = unmount;
                        }

                        if (existing.blockStart.previousSibling !== currentMarker) {
                            console.log("MOVING ITEM");
                            const nodesToMove = [];
                            let node = existing.blockStart;

                            while (node !== existing.blockEnd.nextSibling) {
                                nodesToMove.push(node);
                                node = node.nextSibling;
                            }

                            let previousMarker;

                            nodesToMove.forEach((n, i) => {
                                if (i === 0) previousMarker = n;
                                parent.insertBefore(n, currentMarker);
                            });

                            // insert currentMarker back to its original position
                            parent.insertBefore(currentMarker, previousMarker);
                        }

                        newRenderedItems.push(existing);
                        currentMarker = existing.blockEnd;
                    });
                } else if (elseBlock) {
                    const [blockStart, blockEnd] = startEndTextNode();

                    const unMountSet = new Set();
                    const mountSet = new Set();

                    const unmount = () => {
                        unMountSet.forEach((umount) => umount());
                        unMountSet.clear();
                    };

                    const mount = () => {
                        mountSet.forEach((mount) => mount());
                        mountSet.clear();
                    }

                    parent.insertBefore(blockStart, currentMarker.nextSibling);
                    parent.insertBefore(blockEnd, blockStart.nextSibling);

                    const existing = { item: 0, blockStart, blockEnd, index: 0 };

                    onUnmountQueue.push(unMountSet);
                    onMountQueue.push(mountSet);

                    const elseContent = processTemplate(elseBlock, ctx, components);

                    onUnmountQueue.pop();
                    onMountQueue.pop();

                    blockEnd.before(...elseContent.childNodes);
                    mount();

                    currentMarker = existing.blockEnd;
                    existing.unmount = unmount;

                    newRenderedItems.push(existing);
                }

                // Remove items no longer present
                renderedItems.forEach((r, i) => {
                    const existingItemIndex = newRenderedItems.findIndex((x) => x === r);
                    if (existingItemIndex > -1) {
                        if (existingItemIndex === i) return;
                        if (r.index) r.index.value = existingItemIndex;
                        return;
                    }

                    let node = r.blockStart;
                    let end = r.blockEnd;

                    while (node && node !== r.blockEnd) {
                        const next = node.nextSibling;
                        node.remove();
                        node = next;
                    }

                    if (r.unmount) r.unmount();

                    end.remove();
                });

                renderedItems = newRenderedItems;
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

        const thenMatch = block.match(thenRegex);
        const catchMatch = block.match(catchRegex);
        const loadingContent = block.split(blockRegex)[0] || '';

        const markerId = `await-${makeId(24)}`;

        awaitMap.set(markerId, (markerStart, markerEnd) => {
            return () => {
                let unMountSet = new Set();
                let mountSet = new Set();

                const unmount = () => {
                    unMountSet.forEach((umount) => umount());
                    unMountSet.clear();
                };

                const mount = () => {
                    mountSet.forEach((mount) => mount());
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

                    const loadingNodes = processTemplate(loadingContent, ctx);

                    onUnmountQueue.pop();
                    onMountQueue.pop();

                    markerEnd.before(...loadingNodes.childNodes);
                    mount();
                };

                const showThen = (result) => {
                    clearContent();
                    if (!thenMatch) return;
                    const [_, varName, thenBlock] = thenMatch;

                    onUnmountQueue.push(unMountSet);
                    onMountQueue.push(mountSet);

                    const thenNodes = processTemplate(thenBlock, { ...ctx, [varName]: result });

                    onUnmountQueue.pop();
                    onMountQueue.pop();

                    markerEnd.before(...thenNodes.childNodes);
                    mount();
                };

                const showCatch = (error) => {
                    clearContent();
                    if (!catchMatch) return;
                    const [_, varName, catchBlock] = catchMatch;

                    onUnmountQueue.push(unMountSet);
                    onMountQueue.push(mountSet);

                    const catchNodes = processTemplate(catchBlock, { ...ctx, [varName]: error });

                    onUnmountQueue.pop();
                    onMountQueue.pop();

                    markerEnd.before(...catchNodes.childNodes);
                    mount();
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
    const componentRegex = /<([A-Z][A-Za-z0-9]*)\b([^>]*)\/>|<([A-Z][A-Za-z0-9]*)\b([^>]*)>([\s\S]*?)<\/\3>/g;

    function parseAttributes(attrString, ctx) {
        const attrs = {};
        const regex = /([\w:-]+)(?:="([^"]*)")?/g;
        let match;

        while ((match = regex.exec(attrString)) !== null) {
            const [, key, value] = match;
            attrs[key] = value.startsWith('{{') ? evaluate(value.match(/^{{\s*(.+?)\s*}}$/)[1], ctx) : value;
        }

        return attrs;
    }

    return template.replace(componentRegex, (match, selfTag, selfAttrs, openTag, openAttrs, content) => {

        const componentName = selfTag || openTag;
        if (!components[componentName] || componentName === "Slot") return match;

        const attrs = parseAttributes(selfAttrs || openAttrs, ctx);
        const markerId = `component-${makeId(24)}`;

        componentMap.set(markerId, (startNode, endNode) => {
            let unMountSet = new Set();
            let mountSet = new Set();

            const unmount = () => {
                unMountSet.forEach((umount) => umount());
                unMountSet.clear();
            };

            const mount = () => {
                mountSet.forEach((mount) => mount());
                mountSet.clear();
            }

            const renderSlot = () => processTemplate(content, ctx, components);

            return () => {
                unmount();
                removeNodesBetween(startNode, endNode);

                const component = content ? components[componentName](attrs, renderSlot) : components[componentName](attrs);

                unMountSet = onUnmountQueue.pop();
                mountSet = onMountQueue.pop();

                endNode.parentElement.insertBefore(component, endNode);
                mount();

                const parentUnmount = onUnmountQueue[onUnmountQueue.length - 1];
                if (parentUnmount && !parentUnmount.has(unmount)) parentUnmount.add(unmount);
            }
        })

        return `<div id="${markerId}"></div>`;
    });
}
