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

export class EvalContext {

    /**
     * @type {any}
     */
    #ctx;

    /**
    * @type {string[]}
    */
    #evals = [];

    /**
    * @type {Function[]}
    */
    #callbacks = [];

    constructor(ctx) {
        this.#ctx = ctx;
    }

    /**
    * @param {string} expr
    * @param {(data:any) => void} callback
    */
    push = (expr, callback) => {
        this.#evals.push(expr);
        this.#callbacks.push(callback);
    }

    run = () => {
        try {
            const evaluatedExpr = Function(...Object.keys(this.#ctx), `return [${this.#evals.join(",")}]`)(...Object.values(this.#ctx));
            for (const i in evaluatedExpr) callbacks[i](evaluatedExpr[i]);
        } catch (error) {
            console.error(`Batch evaluation error:`, error, this.#ctx);
        }
    }

    /**
    * @param {any} additional_ctx
    */
    createChildContext = (additional_ctx) => {
        return new EvalContext({ ...ctx, ...additional_ctx });
    }
}
