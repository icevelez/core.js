/**
* @param {any} object
* @returns {boolean}
*/
export function isObject(object) {
    return object && typeof object === "object";
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
* @param {Node} startNode
* @param {Node} endNode
*/
export function removeNodesBetween(startNode, endNode) {
    if (startNode.nextSibling === endNode) return;
    let node = startNode.nextSibling;
    while (node && node !== endNode) {
        const next = node.nextSibling;
        node.parentNode.removeChild(node);
        node = next;
    }
}

const use_comment = true;

export function createStartEndNode(name = 'item') {
    const blockStart = use_comment ? document.createComment(`${name}-start`) : document.createTextNode("");
    const blockEnd = use_comment ? document.createComment(`${name}-end`) : document.createTextNode("");
    return [blockStart, blockEnd];
}
