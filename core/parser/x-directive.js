import { makeId } from "../helper-functions.js";
import { contextWrapper, mountWrapper } from "../internal.js";
import { addBlockToCache, addComponentImports, compileTemplate, processComponents } from "../runtime.js";

/**
* @param {{ template : string, components : Record<string, Function> }} options
* @param {Object} Ctx anonymous class that encapsulate data and logic
* @returns {(anchor:Node, props:Record<string, any>) => () => void}
*/
export function component(options, Ctx = class { }) {
    if (Ctx && !Ctx.toString().startsWith("class")) throw new Error("context is not a class");

    const components_id = makeId(6);
    const template = processComponents(options.template, components_id);
    const template_fn = compileTemplate(parseXDirective(template));

    if (options.components && Object.keys(options.components).length > 0) addComponentImports(components_id, options.components);

    return (anchor, props, slot_fn) => mountWrapper(() => contextWrapper(() => template_fn(anchor, !Ctx ? {} : new Ctx(props), slot_fn)))
}

/**
 * @param {string} source
 * @returns {DocumentFragment}
 */
function parseXDirective(source) {
    const templateSource = document.createElement("template");
    templateSource.innerHTML = source;
    const node = templateSource.content.firstChild
    collectBlocks(node);
    return templateSource.content;
}

/**
 * @param {Node} node
 * @returns {DocumentFragment}
 */
function returnFragment(node) {
    if (node instanceof HTMLTemplateElement) return node.content;
    let fragment = document.createDocumentFragment();
    fragment.append(node);
    return node;
}

/**
 * @param {Node} node
 * @param {string} block_type
 * @param {any} block
 */
function createBlock(node, block_type, block) {
    const block_id = `${block_type}-${makeId(6)}`;
    const blockEl = document.createElement("template");
    blockEl.dataset.block = block_type;
    blockEl.dataset.blockId = block_id;
    (node?.parentElement || node.parentNode).replaceChild(blockEl, node);
    addBlockToCache(block_id, block);
}

/**
 * @param {Node} node
 */
function collectBlocks(node) {
    const firstChild = node.firstChild;
    if (firstChild) collectBlocks(firstChild);

    const nextNode = node.nextSibling;
    const isStyle = node instanceof HTMLStyleElement;
    const isText = node.nodeType === Node.TEXT_NODE;
    if (isText || isStyle) {
        if (nextNode) collectBlocks(nextNode)
        return;
    }

    if (node.getAttribute("x-if")) collectBlock(node, "x-if");
    if (node.getAttribute("x-for")) collectBlock(node, "x-for");
    if (node.getAttribute("x-await")) collectBlock(node, "x-await");
    if (nextNode) collectBlocks(nextNode);
}

/**
 * @param {Node} node
 * @param {string} directive
 * @param {any} block
 */
function collectBlock(node, directive, block) {
    const nextNode = node.nextSibling;

    if (directive === "x-if") {
        const expr = node.getAttribute("x-if") || "";
        const fragment = returnFragment(node);
        const if_block = {
            fns: [compileTemplate(fragment)],
            exprs: [expr]
        };

        collectBlocks(fragment.firstChild);
        createBlock(node, "if", if_block);

        if (!nextNode || nextNode.nodeType === Node.TEXT_NODE) return;
        const directive = nextNode.getAttribute("x-else-if") || nextNode.getAttribute("x-else");
        if (!directive) return;
        collectBlock(nextNode, directive, if_block);
        return;
    } else if (directive === "x-elseif") {
        const expr = node.getAttribute("x-elseif") || "";
        node.remove();

        const fragment = returnFragment(node);
        collectBlocks(fragment.firstChild);

        block.fns.push(compileTemplate(fragment))
        block.exprs.push(expr);

        if (!nextNode || nextNode.nodeType === Node.TEXT_NODE) return;
        const directive = nextNode.getAttribute("x-else-if") || nextNode.getAttribute("x-else");
        if (!directive) return;
        collectBlock(nextNode, directive, block);
        return;
    } else if (directive === "x-else") {
        node.remove();
        const fragment = returnFragment(node);
        collectBlocks(fragment.firstChild);

        block.fns.push(compileTemplate(fragment))
        block.exprs.push("true");
        return;
    }

    if (directive === "x-for") {
        const trimmedVar = (node.getAttribute("x-key") || "").trim();
        const fragment = returnFragment(node);
        collectBlocks(fragment.firstChild);

        const for_block = {
            expr: node.getAttribute("x-for") || "",
            fn: compileTemplate(fragment),
            else_fn: undefined,
            key: trimmedVar,
            keys: trimmedVar.startsWith("{") || trimmedVar.startsWith("[") ? trimmedVar.slice(1, -1).split(",").map(v => v.trim()) : [],
            index_key: node.getAttribute("x-index") || "",
        };

        createBlock(node, "each", for_block);

        if (!nextNode || nextNode.nodeType === Node.TEXT_NODE) return;
        const has_empty = nextNode.hasAttribute("x-empty");
        if (!has_empty) return;
        const else_fragment = returnFragment(nextNode);
        collectBlocks(else_fragment.firstChild);

        for_block.else_fn = compileTemplate(else_fragment);
        nextNode.remove();
        return;
    }

    if (directive === "x-await") {
        const fragment = returnFragment(node);
        collectBlocks(fragment.firstChild);

        const await_block = {
            expr: (node.getAttribute("x-await") || "").trim(),
            pending_fn: fragment,
            then_fn: undefined,
            then_key: undefined,
            catch_fn: undefined,
            catch_key: undefined,
        }

        if (!nextNode || nextNode.nodeType === Node.TEXT_NODE) return;
        const nextNextNode = nextNode.nextSibling;
        if (nextNode.hasAttribute("x-then")) {
            const then_fragment = returnFragment(nextNode);
            collectBlocks(then_fragment.firstChild);
            await_block.then_key = nextNode.getAttribute("x-then") || "";
            await_block.then_fn = compileTemplate(then_fragment);
        }

        if (!nextNextNode || nextNextNode.nodeType === Node.TEXT_NODE) return;
        if (nextNextNode.hasAttribute("x-catch")) {
            const catch_fragment = returnFragment(nextNode);
            collectBlocks(catch_fragment.firstChild);
            await_block.catch_key = nextNextNode.getAttribute("x-catch") || "";
            await_block.catch_fn = compileTemplate(catch_fragment);
        }
    }
}
