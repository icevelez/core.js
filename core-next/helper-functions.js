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

export function escapeTemplateLiteral(str) {
    return str
        .replace(/\\/g, '\\\\')   // escape backslashes
        .replace(/`/g, '\\`')     // escape backticks
        .replace(/\$\{/g, '\\${'); // prevent interpolation
}
