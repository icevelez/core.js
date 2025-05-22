const use_comment = true; // used to debug anchor points for "if", "each", "await"

/**
* @param {any} object
* @returns {boolean}
*/
export function isObject(object) {
    return object && typeof object === "object";
}

/**
* To make it easier for myself to have a "typed" Set instead of adding type for each declaration
* @returns {Set<Function>}
*/
export function newSetFunc() {
    return new Set();
}

/**
* @param {number} length
*/
export function makeId(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

/**
*
* @param {Node} startNode
* @param {Node} endNode
*/
export function removeNodesBetween(startNode, endNode) {
    let node = startNode.nextSibling;
    while (node && node !== endNode) {
        const next = node.nextSibling;
        node.parentNode.removeChild(node);
        node = next;
    }
}

/**
* @param {Node} targetElement
* @param {string} text
*/
export function insertTextAfter(targetElement, text) {
    const textNode = document.createTextNode(text);
    const parent = targetElement.parentNode;
    if (parent) parent.insertBefore(textNode, targetElement.nextSibling);
}

let commentCounter = 1;

export function createStartEndNode(name = 'item') {
    const rand = commentCounter++;
    const blockStart = use_comment ? document.createComment(`${name}-start-${rand}`) : document.createTextNode("");
    const blockEnd = use_comment ? document.createComment(`${name}-end-${rand}`) : document.createTextNode("");
    return [blockStart, blockEnd];
}

/**
* @param {string} expr
* @param {any} ctx
* @returns {any}
*/
export function evaluate(expr, ctx) {
    try {
        return Function(...Object.keys(ctx), `return (${expr});`)(...Object.values(ctx));
    } catch (e) {
        console.error(`Evaluation error: ${expr}`, e, ctx);
        return {};
    }
}
