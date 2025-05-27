import { makeId } from "../../helper-functions.js";

const directiveBlocks = {
    if: [],
    each: [],
    await: [],
    component: [],
};

window.__directiveBlocks = directiveBlocks;

/**
* @param {string} template
*/
function parseDirectiveBlocks(template) {
    const directives = ["if", "each", "await"].map((i) => [`{{#${i}`, `{{/${i}}}`, i]);
    const directiveBlockDepth = [];

    let i = 0;
    let depth = -1;

    const openTagIndexes = [];

    templateLoop:
    while (i < template.length) {

        for (const [openTag, closeTag, directive] of directives) {
            if (template.slice(i, i + openTag.length) === openTag) {
                openTagIndexes.push(i);
                i += openTag.length;
                depth++;
                continue templateLoop;
            }

            if (template.slice(i, i + closeTag.length) === closeTag) {
                const closeTagIndex = i + closeTag.length;
                const openTagIndex = openTagIndexes.pop();

                const block = template.slice(openTagIndex, closeTagIndex);
                directiveBlocks[directive].push(block);

                if (!directiveBlockDepth[depth]) directiveBlockDepth[depth] = [];

                directiveBlockDepth[depth].push([block, directive]);

                depth--;
                i += closeTag.length;
                continue templateLoop;
            }
        }

        i++;
    }

    return directiveBlockDepth;
}

function preprocessTemplates(template, directiveBlockDepth, depth) {
    const depthBlocks = directiveBlockDepth[depth];

    for (const i in depthBlocks) {
        let [block, directive] = depthBlocks[i];
        const marker_id = `${directive}-${makeId(8)}`;
        const marker_element = `<div data-directive="${directive}" data-marker-id="${marker_id}"></div>`;
        block = preprocessTemplates(block, directiveBlockDepth, depth + 1);
        template = template.replace(block, marker_element);
    }

    return template;
}

function processComponentBlocks(template, imported_components_id) {
    const componentRegex = /<([A-Z][A-Za-z0-9]*)\s*((?:[^>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>(?:([\s\S]*?)<\/\1>)?/g;
    const directive = "component";

    template = template.replace(componentRegex, (match, tag, attrStr, _, slot_content) => {
        if (match.startsWith("<Core:slot")) return `<div data-directive="slot"></div>`;
        if (match.startsWith("<Core:component")) return `<div data-directive="core-component" ${attrStr.slice(10)}>${slot_content}</div>`;

        const marker_id = `${directive}-${makeId(8)}`;
        const component = { import_id: imported_components_id, tag, attrStr, slot_content };
        directiveBlocks[directive].push(component);

        return `<div data-import-id="${imported_components_id}" data-directive="${directive}" data-marker-id="${marker_id}"></div>`;
    })

    return template;
}

let template = `
        {{#if outer}}
            {{#if inner}}
                {{#if inner_inner}}

                {{/if}}
            {{:else}}
                {{#if inner_inner_else}}

                    {{#each items as item}}
                        {{#if inner_inner_each}}

                        {{/if}}
                    {{:empty}}
                        <MyComponent/>
                    {{/each}}
                {{/if}}
            {{/if}}
        {{/if}}


        {{#if outer_sibling}}

        {{/if}}
    `;

template = processComponentBlocks(template, 1);

const depthBlock = parseDirectiveBlocks(template);

console.log(preprocessTemplates(template, depthBlock, 0), depthBlock);
