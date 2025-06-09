import { evaluate } from "../../helper-functions.js";

const processDirectives = {
    each: null,
    if: null
};

const processedBlocks = {
    await: new Map(),
    if: new Map(),
    each: new Map(),
    component: new Map(),
}

/**
*
* @param {ChildNode} node
* @param {DocumentFragment} destinationNode
* @param {Record<string, any>} ctx
*/
export function processNode(node, destinationNode, ctx) {
    const isText = node.nodeType === Node.TEXT_NODE;

    if (isText) {
        const expression = node.textContent;
        const regex = /{{\s*([^#\/][^}]*)\s*}}/g;

        node.textContent = expression.replace(regex, (_, expr) => evaluate(expr, ctx));

        destinationNode.appendChild(node)
        return;
    }

    if (node.nodeType === Node.COMMENT_NODE) {
        destinationNode.appendChild(node);
        return;
    }

    for (const attr of node.attributes) {
        const attrName = attr.name.toLowerCase();
        const attrValue = attr.value;

        if (attr.name.startsWith("x-")) {
            const directive = attrName.slice(2, attrName.length);
            if (!processDirectives[directive]) continue;

            processDirectives[directive](attrValue, node, ctx);

            continue;
        }

    };

    for (const childNode of Array.from(node.childNodes)) {
        processNode(childNode, node, ctx);
    }

    destinationNode.append(node);
}

/**
*
* @param {string} expr
* @param {Node} node
* @param {any} ctx
*/
function processEachBlock(expr, node, ctx) {
    const eachRegex = /\s+(.+?)\s+as\s+(\w+)(?:,\s*(\w+))?/g;

    const newRenderedBlocks = [];
    const blockDatas = evaluate(eachConfig.expression, ctx) || [];
    const [nodeStart, nodeEnd] = createStartEndNode('each-block');
}
