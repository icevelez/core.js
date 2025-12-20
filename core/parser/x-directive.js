import { makeId } from "../helper-functions.js";
import { addBlockToCache, compileTemplate, createComponent } from "../runtime.js";

/**
* @param {{ template : string, components : Record<string, Function> }} options
* @param {Object} Ctx anonymous class that encapsulate data and logic
* @returns {(anchor:Node, props:Record<string, any>) => () => void}
*/
export function component(options, Ctx = class { }) {
    return createComponent(options, Ctx, function (source) {
        const templateSource = document.createElement("template");
        templateSource.innerHTML = source;
        collectBlocks(templateSource.content.firstChild);
        return templateSource.content;
    })
}

/**
 * @param {Node} node
 * @returns {DocumentFragment}
 */
function returnFragment(node) {
    if (node instanceof HTMLTemplateElement) return node.content;
    let fragment = document.createDocumentFragment();
    fragment.append(node);
    return fragment;
}

/**
 * @param {Node} node
 * @param {string} block_type
 * @param {any} block
 */
function addBlock(node, block_type, block) {
    const block_id = `${block_type}-${makeId(6)}`;
    const blockEl = document.createElement("template");
    blockEl.dataset.block = block_type;
    blockEl.dataset.blockId = block_id;
    node.parentNode.replaceChild(blockEl, node);
    addBlockToCache(block_id, block);
}

/**
 * @param {Node} node
 */
function collectBlocks(node) {
    if (node.nodeType === Node.TEXT_NODE) return;
    const firstChild = node.firstChild;
    if (firstChild) collectBlocks(firstChild);
    const nextNode = node.nextSibling;
    const isStyle = node instanceof HTMLStyleElement;
    const isText = node.nodeType === Node.TEXT_NODE;
    if (isText || isStyle) return nextNode ? collectBlocks(nextNode) : undefined;
    for (const directive of ["x-if", "x-for", "x-await"]) {
        if (node.hasAttribute(directive)) collectBlock(node, directive);
    }
    if (nextNode) collectBlocks(nextNode);
}

function getNextSibling(node) {
    return !node.nextSibling ? undefined : (node.nextSibling.nodeType === Node.TEXT_NODE) ? getNextSibling(node.nextSibling) : node.nextSibling;
}

/**
 * @param {Node} node
 * @param {string} directive
 * @param {any} block
 */
function collectBlock(node, directive, block) {
    const nextNode = getNextSibling(node);

    if (directive === "x-if") {
        const expr = node.getAttribute("x-if") || "";
        const fragment = returnFragment(node);
        collectBlocks(fragment.firstChild);
        const if_block = {
            fns: [compileTemplate(fragment)],
            exprs: [expr]
        };

        addBlock(node, "if", if_block);

        if (!nextNode || nextNode.nodeType === Node.TEXT_NODE) return;
        const has_directive = nextNode.getAttribute("x-else-if") ? "x-else-if" : nextNode.getAttribute("x-else") ? "x-else" : "";
        if (!has_directive) return;
        collectBlock(nextNode, has_directive, if_block);
        return;
    } else if (directive === "x-else-if") {
        const expr = node.getAttribute("x-else-if") || "";
        node.remove();

        const fragment = returnFragment(node);
        collectBlocks(fragment.firstChild);

        block.fns.push(compileTemplate(fragment))
        block.exprs.push(expr);

        if (!nextNode) return;
        const has_directive = nextNode.getAttribute("x-else-if") ? "x-else-if" : nextNode.getAttribute("x-else") ? "x-else" : "";
        if (!has_directive) return;
        collectBlock(nextNode, has_directive, block);
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

        addBlock(node, "each", for_block);

        if (!nextNode) return;
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
            pending_fn: compileTemplate(fragment),
            then_fn: undefined,
            then_key: undefined,
            catch_fn: undefined,
            catch_key: undefined,
        }

        addBlock(node, "await", await_block);

        if (!nextNode) return;
        const nextNextNode = getNextSibling(nextNode);
        console.log(nextNextNode);
        if (nextNode.hasAttribute("x-then")) {
            const then_fragment = returnFragment(nextNode);
            nextNode.remove();
            collectBlocks(then_fragment.firstChild);
            await_block.then_key = nextNode.getAttribute("x-then") || "";
            await_block.then_fn = compileTemplate(then_fragment);
        }

        if (!nextNextNode) return;
        if (nextNextNode.hasAttribute("x-catch")) {
            const catch_fragment = returnFragment(nextNode);
            nextNextNode.remove();
            collectBlocks(catch_fragment.firstChild);
            await_block.catch_key = nextNextNode.getAttribute("x-catch") || "";
            await_block.catch_fn = compileTemplate(catch_fragment);
        }
    }
}
