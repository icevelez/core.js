/** @type {(obj:any) => Boolean} */
export const isObject = (obj) => obj && typeof obj === "object";

/** @type {(length:number) => string} */
export const makeId = (length) => {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    for (var i = 0; i < length; i++) result += characters.charAt(Math.floor(Math.random() * characters.length));
    return result;
}

/** @type {(str:string) => string} */
export const escapeTemplateLiteral = (str) => str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
