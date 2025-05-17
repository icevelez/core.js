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
        const ctx = new Context(props);
        if (ctx instanceof Promise) throw new Error(`component context cannot be a promise`);
        const unmount = onUnMountQueue.pop();
        const template = processTemplate(options.template, ctx, options.components);
        if (unmount) onUnMountQueue.push(unmount);
        return template;
    };
}

/**
*
* @param {HTMLElement} node
* @param {any} ctx
* @param {DocumentFragment} parentFragment
*/
function processNode(node, ctx, parentFragment) {
    console.log("NODE", node);

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
* @param {string} template
* @param {any} ctx
* @param {{ [key:string] : Function }} components
*/
function processTemplate(template, ctx, components = {}) {

    /**
    * @type {Map<string, (startNode:Text, endNode:Text) => (() => void)>}
    */
    const ifMap = new Map();

    // Process IF and IF-ELSE and ELSE
    const ifRegex = /{{#if\s+(.+?)}}([\s\S]*?){{\/if}}/g;
    const ifElseregex = /{{else\s+if\s+(.+?)}}|{{else}}/g;
    template = template.replace(ifRegex, (fullMatch, firstCondition, firstBlock) => {
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
                    console.log("IF", segments);

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

    /**
    * @type {Map<string, (startNode:Text, endNode:Text) => (() => void)>}
    */
    const eachMap = new Map();

    const eachRegex = /{{#each\s+(.+?)\s+as\s+(\w+)(?:,\s*(\w+))?}}([\s\S]*?){{\/each}}/g;
    template = template.replace(eachRegex, (_, listExpr, itemName, indexName, block) => {
        const markerId = `each-${makeId(24)}`;

        eachMap.set(markerId, (startMarker, _) => {
            return () => {
                const parent = startMarker.parentNode;

                let renderedItems = [];

                effect(() => {
                    let newRenderedItems = [];
                    const list = evaluate(listExpr, ctx) || [];
                    let currentMarker = startMarker;

                    console.log("EACH");
                    list.forEach((item, index) => {
                        let existing = renderedItems.find(r => r.item === item);

                        if (!existing) {
                            console.log(index, 'not existing', renderedItems, item);

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

                            // The code below is IMPORTANT! DO NOT DELETE! It is to prevent {{#each}} effect from cleaning up
                            // its child effect because the way {{#each}} work, is it re-uses existing children instead of
                            // re-creating them and without the code below, {{#each}} effect will clean up the existing child effect
                            // making the existing child elements non-reactive

                            // to fix this, I added this `untrack_from_parent()` effect to detatch it and cleaning it up manually
                            // by attaching the effect cleanup to item's unmount function when {{#each}} clears out
                            // child elements that isn't part of its "renderedItems"

                            untrack_from_parent_effect(() => {
                                const cleanup = effect(() => {
                                    const blockContent = processTemplate(block, childCtx, components);
                                    blockEnd.before(...blockContent.childNodes);
                                    console.log(blockEnd, item);
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

                    // Remove items no longer present
                    renderedItems.forEach(r => {
                        if (newRenderedItems.includes(r)) return;

                        console.log("REMOVING...", r);

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
            }
        });

        return `<div id="${markerId}"></div>`;
    });

    /**
    * @type {Map<string, (startNode:Text, endNode:Text) => (() => void)>}
    */
    const awaitMap = new Map();

    const awaitRegex = /{{#await\s+(.+?)}}([\s\S]*?){{\/await}}/g;
    const thenRegex = /{{then\s+(\w+)}}([\s\S]*?)(?={{:|$)/;
    const catchRegex = /{{catch\s+(\w+)}}([\s\S]*?)(?={{:|$)/;
    const blockRegex = /{{then[\s\S]*?}}|{{catch[\s\S]*?}}/;
    template = template.replace(awaitRegex, (_, promiseExpr, block) => {

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

    /**
    * @type {Map<string, (startNode:Text, endNode:Text) => (() => void)>}
    */
    const componentMap = new Map();

    const componentRegex = /(<([A-Z][a-zA-Z0-9]*)(\s[^<>]*?)?\/>)/g;
    template = template.replace(componentRegex, (expr, _, componentName, componentAttr) => {
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

    // ======================================================

    const div = document.createElement('div');
    div.innerHTML = template;

    const fragment = document.createDocumentFragment();

    const markernames = ['if', 'each', 'await', 'component'];

    [ifMap, eachMap, awaitMap, componentMap].forEach((x, i) => {
        x.forEach((func, key) => {
            const markerElement = div.querySelector(`#${key}`);
            const [textNodeStart, textNodeEnd] = startEndTextNode(markernames[i]);

            markerElement.replaceWith(textNodeEnd);
            textNodeEnd.parentElement.insertBefore(textNodeStart, textNodeEnd);

            const render = func(textNodeStart, textNodeEnd);
            render()
        })
    })

    Array.from(div.childNodes).forEach(node => {
        processNode(node, ctx, fragment);
    });

    return fragment;
}
