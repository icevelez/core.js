
/**
* Regex alone mismatch `{{}}` syntax, which needs this to properly get a handlebar block
* @param {string} template
* @param {string} openTag
* @param {string} clsoeTag
*/
function parseOuterBlocks(template, openTag, closeTag) {

    const blocks = [];
    let i = 0;
    let depth = 0;
    let start = -1;

    const openTagIndexes = [];
    const closeTagIndexes = [];

    while (i < template.length) {
        if (template.slice(i, i + openTag.length) === openTag) {
            openTagIndexes.push(i);
            if (depth === 0) start = i;
            depth++;
            i += openTag.length;
            continue;
        }
        if (template.slice(i, i + closeTag.length) === closeTag) {
            closeTagIndexes.push(i + closeTag.length);
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

    if (openTagIndexes.length !== closeTagIndexes.length) throw new Error("template error");

    const closeTagBase = closeTagIndexes[4];

    const openTagsInBetween = [];
    const closeTagInBetween = [];

    for (let i = 0; i < openTagIndexes.length; i++) {
        const openTag = openTagIndexes[i];
        const closeTag = closeTagIndexes[i];
        if (openTag < closeTagBase) openTagsInBetween.push(openTag);
        if (closeTag < closeTagBase) closeTagInBetween.push(closeTag);
    }

    openTagsInBetween.splice(openTagsInBetween.length - closeTagInBetween.length, closeTagInBetween.length)

    const lastOpenTag = openTagsInBetween[openTagsInBetween.length - 1];

    console.log(template.slice(lastOpenTag, closeTagBase));

    console.log("final", openTagIndexes, closeTagIndexes, closeTagBase, lastOpenTag)
    return blocks;
}

const template = `
        {{#if outer}}
            {{#if inner}}
                {{#if inner_inner}}

                {{/if}}
            {{:else}}
                {{#if inner_inner_else}}

                {{/if}}
            {{/if}}
        {{/if}}


        {{#if outer_sibling}}

        {{/if}}
    `;

const blocks = parseOuterBlocks(template, "{{#if", "{{/if}}");
