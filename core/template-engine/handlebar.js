import { effect, untrack_from_parent_effect } from "../reactivity.js";
import { evaluate, makeId, removeNodesBetween, startEndTextNode } from "../helper-functions.js";
import { onMountQueue, onUnMountQueue } from "../internal-core.js"

/**
* @param {{ template : string, components : { [key:string] : Function } }} options
* @param {any} Context
* @returns {(props?:Record<string, any>) => DocumentFragment}
*/
export function component(options, Context) {
    return function (props = {}) {
        if (Context.toString().substring(0, 5) !== "class") throw new Error("context is not a class instance");
        const ctx = new Context(props);
        const unmount = onUnMountQueue.pop();
        const template = processTemplate(options.template, ctx, options.components);
        if (unmount) onUnMountQueue.push(unmount);
        return template;
    };
}

/**
* @param {string} template
* @param {any} ctx
* @param {{ [key:string] : Function }} components
*/
function processTemplate(template, ctx, components = {}) {

    // holds callback function to convert marked element to its dynamic content
    const processedMaps = {
        if: new Map(),
        each: new Map(),
        await: new Map(),
        component: new Map()
    };

    template = processIf(processedMaps.if, template, ctx, components);
    template = processEach(processedMaps.each, template, ctx, components);
    template = processAwait(processedMaps.await, template, ctx, components);
    template = processComponents(processedMaps.component, template, ctx, components);

    const div = document.createElement('div');
    div.innerHTML = template;

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

    Array.from(div.childNodes).forEach(node => processNode(node, ctx, fragment));

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
        const regex = /{{\s*([^#\/][^}]*)\s*}}/g;
        const expression = node.textContent;

        effect(() => {
            node.textContent = expression.replace(regex, (_, expr) => evaluate(expr, ctx))
        });

        parentFragment.appendChild(node);
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
                const func = evaluate(rawExpr, { ...ctx });
                node.addEventListener(attrName.slice(2), func);
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
            let unmount;
            return () => {
                effect(() => {
                    if (unmount) unmount();
                    removeNodesBetween(startNode, endNode);
                    const fragment = document.createDocumentFragment();

                    for (const segment of segments) {
                        if (evaluate(segment.condition, ctx)) {
                            fragment.appendChild(processTemplate(segment.block, ctx, components));
                            unmount = onUnMountQueue.pop();
                            break;
                        }
                    }

                    endNode.parentNode.insertBefore(fragment, endNode);
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

            effect(() => {
                let newRenderedItems = [];
                const list = evaluate(listExpr, ctx) || [];
                let currentMarker = startMarker;

                if (list.length > 0) {
                    list.forEach((item, index) => {
                        let existing = renderedItems.find(r => r.item === item);

                        if (!existing) {
                            const [blockStart, blockEnd] = startEndTextNode();

                            // Insert block markers
                            parent.insertBefore(blockStart, currentMarker.nextSibling);
                            parent.insertBefore(blockEnd, blockStart.nextSibling);

                            existing = { item, blockStart, blockEnd, index };
                            const childCtx = { ...ctx, [itemName]: item };
                            if (indexName) {
                                childCtx[indexName] = index;
                            }

                            let node = blockStart.nextSibling;
                            while (node && node !== blockEnd) {
                                const next = node.nextSibling;
                                node.remove();
                                node = next;
                            }

                            // Search "SECTION #1" for full comment
                            untrack_from_parent_effect(() => {
                                const cleanup = effect(() => {
                                    const mainBlockContent = processTemplate(mainBlock, childCtx, components);
                                    blockEnd.before(...mainBlockContent.childNodes);
                                })

                                const unmount = onUnMountQueue.pop();
                                existing.unmount = () => {
                                    cleanup();
                                    if (unmount) unmount();
                                };
                            })
                        }

                        if (existing.blockStart.previousSibling !== currentMarker) {
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

                    parent.insertBefore(blockStart, currentMarker.nextSibling);
                    parent.insertBefore(blockEnd, blockStart.nextSibling);

                    const existing = { item: 0, blockStart, blockEnd, index: 0 };

                    // Search "SECTION #1" for full comment
                    untrack_from_parent_effect(() => {
                        const cleanup = effect(() => {
                            const elseContent = processTemplate(elseBlock, ctx, components);
                            blockEnd.before(...elseContent.childNodes);
                        })

                        const unmount = onUnMountQueue.pop();
                        existing.unmount = () => {
                            cleanup();
                            if (unmount) unmount();
                        };
                    })

                    newRenderedItems.push(existing);
                    currentMarker = existing.blockEnd;
                }

                // Remove items no longer present
                renderedItems.forEach(r => {
                    if (newRenderedItems.includes(r)) return;

                    let node = r.blockStart;
                    let end = r.blockEnd;

                    while (node && node !== r.blockEnd) {
                        const next = node.nextSibling;
                        node.remove();
                        node = next;
                    }

                    end.remove();

                    if (r.unmount) r.unmount();
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
            let unmount;
            return () => {
                const clearContent = () => {
                    let node = markerStart.nextSibling;
                    while (node && node !== markerEnd) {
                        const next = node.nextSibling;
                        node.remove();
                        node = next;
                    }
                };

                const showLoading = () => {
                    clearContent();
                    const loadingNodes = processTemplate(loadingContent, ctx);
                    markerEnd.before(...loadingNodes.childNodes);
                    unmount = onUnMountQueue.pop();
                    const onMount = onMountQueue.pop();
                    if (onMount) onMount();
                };

                const showThen = (result) => {
                    clearContent();
                    if (!thenMatch) return;
                    const [_, varName, thenBlock] = thenMatch;
                    const thenNodes = processTemplate(thenBlock, { ...ctx, [varName]: result });
                    markerEnd.before(...thenNodes.childNodes);
                    unmount = onUnMountQueue.pop();
                    const onMount = onMountQueue.pop();
                    if (onMount) onMount();
                };

                const showCatch = (error) => {
                    clearContent();
                    if (!catchMatch) return;
                    const [_, varName, catchBlock] = catchMatch;
                    const catchNodes = processTemplate(catchBlock, { ...ctx, [varName]: error });
                    markerEnd.before(...catchNodes.childNodes);
                    unmount = onUnMountQueue.pop();
                    const onMount = onMountQueue.pop();
                    if (onMount) onMount();
                };

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
    const componentRegex = /(<([A-Z][a-zA-Z0-9]*)(\s[^<>]*?)?\/>)/g;
    return template.replace(componentRegex, (expr, _, componentName, componentAttr) => {
        if (!components[componentName]) return expr;

        const propsRegex = /props\s*=\s*["'](.*?)["']/;
        const match = componentAttr.match(propsRegex);

        let props = () => ({});

        if (match) {
            const regex = /{{\s*([^#\/][^}]*)\s*}}/g;
            const expr = match[1].replace(regex, (_, expr) => expr);
            props = () => evaluate(expr, ctx);
        }

        const markerId = `each-${makeId(24)}`;

        componentMap.set(markerId, (startNode, endNode) => {
            let unmount;
            return () => {
                if (unmount) unmount();
                removeNodesBetween(startNode, endNode);
                const component = components[componentName](props());
                endNode.parentElement.insertBefore(component, endNode);
                unmount = onUnMountQueue.pop();
                const onMount = onMountQueue.pop();
                if (onMount) onMount();
            }
        })

        return `<div id="${markerId}"></div>`;
    });
}

// ============================================

/*
    SECTION #1
    That code is IMPORTANT! DO NOT DELETE! It is to prevent {{#each}} effect from cleaning up
    its child effect because the way {{#each}} work, is it re-uses existing children instead of
    re-creating them and without the code below, {{#each}} effect will clean up the existing child effect
    making the existing child elements non-reactive

    to fix this, I added this `untrack_from_parent()` effect to detatch it and cleaning it up manually
    by attaching the effect cleanup to item's unmount function when {{#each}} clears out
    child elements that isn't part of its "renderedItems"

*/
