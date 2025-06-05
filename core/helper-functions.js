const use_comment = Boolean(window.__corejs__);                     // used to debug anchor points for "if", "each", "await"

const evaluationCache = new Map();

if (window.__corejs__) {
    window.__corejs__.evaluationCache = evaluationCache;
}

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
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}


/**
* Regex alone mismatch nested `{{#directive}}` control flow so to fix that issue, this function was created to properly get the outermost handlebar block
* @param {string} template
* @param {string} openTag
* @param {string} clsoeTag
*/
export function parseOuterBlocks(template, openTag, closeTag) {

    const blocks = [];
    let i = 0;
    let depth = 0;
    let start = -1;

    while (i < template.length) {
        if (template.slice(i, i + openTag.length) === openTag) {
            if (depth === 0) start = i;
            depth++;
            i += openTag.length;
            continue;
        }
        if (template.slice(i, i + closeTag.length) === closeTag) {
            depth--;
            if (depth === 0 && start !== -1) {
                const block = template.slice(start, i + closeTag.length);
                blocks.push(block);
                start = -1;
            }
            i += closeTag.length;
            continue;
        }
        i++;
    }

    return blocks;
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
    const key = `${Object.keys(ctx).join(",")} ${expr}`;
    let evalFunc = evaluationCache.get(key)
    if (!evalFunc) {
        evalFunc = Function(...Object.keys(ctx), `return (${expr});`);
        evaluationCache.set(key, evalFunc);
    }

    try {
        return evalFunc(...Object.values(ctx));
    } catch (e) {
        console.error(`Evaluation error: ${expr}`, e, ctx);
        return {};
    }
}
