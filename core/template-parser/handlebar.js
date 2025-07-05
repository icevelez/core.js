import { makeId, parseOuterBlocks } from "../helper-functions.js";
import { setContextQueue, pushNewContext } from "../internal-core.js";
import { onMount } from "../core.js";

import { slotCache, markedNodeCache, componentObj, imported_components, createNodes, createFragment } from "../engine.js";

/**
* @param {{ template : string, components : Record<string, Function> }} options
* @param {Object} Model anonymous class that encapsulate logic
* @returns {(props:Record<string, any>, render_slot_callbackfn:() => DocumentFragment) => DocumentFragment}
*/
export function component(options, Model = class { }) {

    const components_id = componentObj.id_counter;
    componentObj.id_counter++;

    let template = processComponents(options.template, components_id);
    if (options.components && Object.keys(options.components).length > 0) imported_components.set(components_id, options.components);

    const fragment = createNodes(parseTemplate(template));

    if (Model && Model.toString().substring(0, 5) !== "class") throw new Error("context is not a class instance");

    return function (props, render_slot_callbackfn) {
        if (componentObj.stack.has(components_id)) throw new Error("cyclic component dependency detected!")
        componentObj.stack.add(components_id);

        // add a new `Map<any,any>` to the context stack to collect all set context when the new Model is instantiated
        const current_context = pushNewContext();
        let resetContext;

        // setting a copy of the current context when executing onMount to preserve the context stack when using `onMount` inside the Model class
        // then pushing another onMount after instantiating both the new Model and createFragment to reset the context stack to its previous state
        onMount(() => {
            resetContext = setContextQueue(current_context);
        });

        const ctx = !Model ? {} : new Model(props);
        const processed_fragment = createFragment(fragment, ctx, render_slot_callbackfn);

        onMount(() => {
            resetContext();
        });

        componentObj.stack.delete(components_id);

        return processed_fragment;
    }
}


/**
* @param {string} eachBlock
*/
function parseEach(eachBlock) {
    const eachRegex = /{{#each\s+(.+?)\s+as\s+((?:\w+|\{[\s\S]*?\}|\([\s\S]*?\)))\s*(?:,\s*(\w+))?}}([\s\S]*?){{\/each}}/g;
    let eachConfig = { expression: "", mainContent: [], emptyContent: [], blockVars: [], blockVar: "", indexVar: "" }

    eachBlock.replace(eachRegex, (_, expression, blockVar, indexVar, content) => {
        const [mainContent, emptyContent] = content.split(/{{:empty}}/);
        eachConfig = { expression, blockVars: [], blockVar, indexVar, mainContent: createNodes(mainContent), emptyContent: emptyContent ? createNodes(emptyContent) : [] };
    });

    const blockvar = eachConfig.blockVar.trim();
    if (blockvar.startsWith("{")) eachConfig.blockVars = blockvar.replace("{", "").replace("}", "").trim().split(",").map(v => v.trim());

    return eachConfig;
}

/**
* @param {string} ifBlock
*/
function parseIf(ifBlock) {
    const ifRegex = /{{#if\s+(.+?)}}([\s\S]*?){{\/if}}/g;
    const ifElseregex = /{{:else\s+if\s+(.+?)}}|{{:else}}/g;

    /** @type {{ block : string, condition : string }[]} */
    const segments = [];

    ifBlock.replace(ifRegex, (_, firstCondition, firstBlock) => {
        let lastIndex = 0;
        let match;

        while ((match = ifElseregex.exec(firstBlock)) !== null) {
            if (match.index > lastIndex) {
                segments.push({
                    condition: firstCondition,
                    block: createNodes(firstBlock.substring(lastIndex, match.index))
                });
            }

            if (match[0].startsWith('{{:else if')) {
                firstCondition = match[1];
                lastIndex = match.index + match[0].length;
            } else if (match[0] === '{{:else}}') {
                segments.push({
                    condition: 'true', // Always true for else
                    block: createNodes(firstBlock.substring(match.index + match[0].length))
                });
                lastIndex = firstBlock.length; // Done
            }
        }

        if (lastIndex < firstBlock.length) {
            segments.push({
                condition: firstCondition,
                block: createNodes(firstBlock.substring(lastIndex))
            });
        }
    });

    return segments;
}

/**
* @param {string} awaitBlock
*/
function parseAwait(awaitBlock) {
    const awaitRegex = /{{#await\s+(.+?)}}([\s\S]*?){{\/await}}/g;
    const thenRegex = /\{\{:then(?:\s+(\w+))?\}\}(.*?)(?={{:|$)/s;
    const catchRegex = /\{\{:catch(?:\s+(\w+))?\}\}(.*?)(?={{:|$)/s;
    const blockRegex = /{{:then[\s\S]*?}}|{{catch[\s\S]*?}}/;

    const awaitConfig = {
        promiseExpr: "",
        pendingContent: [],
        then: { match: false, var: null, expr: "", content: [], },
        catch: { match: false, var: null, expr: "", content: [], },
    }

    awaitBlock.replace(awaitRegex, (_, promiseExpr, block) => {
        awaitConfig.promiseExpr = promiseExpr;

        const thenMatch = block.match(thenRegex);
        if (thenMatch) {
            const [_, thenVar, thenContent] = thenMatch;
            awaitConfig.then = { match: true, var: thenVar, content: thenContent ? createNodes(thenContent) : [] };
        }

        const catchMatch = block.match(catchRegex);
        if (catchMatch) {
            const [_, catchVar, catchContent] = thenMatch;
            awaitConfig.catch = { match: true, var: catchVar, content: catchContent ? createNodes(catchContent) : [] };
        }

        const pendingContent = block.split(blockRegex)[0] || '';
        awaitConfig.pendingContent = createNodes(pendingContent);
    });

    return awaitConfig;
}

/**
* Replaces handlebar directive like `{{#if}}` or `{{#each}}` with a placeholder element and processed by a custom function
* @param {string} template
*/
function parseTemplate(template) {
    template = processDirectiveBlocks(template, "await", parseAwait);
    template = processDirectiveBlocks(template, "if", parseIf);
    template = processDirectiveBlocks(template, "each", parseEach);
    return template;
}

/**
* Indirect recursive function to process handlebar directive, replacing it with a placeholder `<template>` element
* then process the contents of each directive block with its respective processor function and cached to be used upon rendering
* @param {string} template
* @param {string} directive
* @param {Function} processBlocks
*/
function processDirectiveBlocks(template, directive, processBlocks) {

    const openTag = `{{#${directive}`;
    const closeTag = `{{/${directive}}}`;
    const blocks = parseOuterBlocks(template, openTag, closeTag);

    for (const i in blocks) {
        const marker_id = `${directive}-${makeId(8)}`;

        template = template.replace(blocks[i], `<template data-directive="${directive}" data-marker-id="${marker_id}"></template>`)

        const start = blocks[i].match(new RegExp(`\\{\\{#${directive}\\s+(.*?)\\}\\}`))[0];
        const end = blocks[i].lastIndexOf(`{{/${directive}}}`);
        const block = blocks[i].slice(0, end).replace(start, "");

        blocks[i] = start + parseTemplate(block) + `{{/${directive}}}`;

        markedNodeCache.set(marker_id, processBlocks(blocks[i]));
    }

    return template;
}

/**
* Replaces all custom HTML Tags with capital first letter with a placeholder element to be replaced later
* @param {string} template
* @param {number} imported_component_id
*/
function processComponents(template, imported_component_id) {
    const componentRegex = /<([A-Z][A-Za-z0-9]*)\s*((?:[^>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>(?:([\s\S]*?)<\/\1>)?/g;
    const directive = "component";

    template = template.replace(componentRegex, (match, tag, attrStr, _, slot_content) => {
        if (match.startsWith("<Core:slot")) return `<template data-directive="slot"></template>`;
        if (match.startsWith("<Core:component")) {
            if (slot_content) {
                const slot_id = `slot-${makeId(6)}`;
                slotCache.set(slot_id, createNodes(slot_content))
                return `<template data-directive="core-component" data-slot-id="${slot_id}" ${attrStr.slice(10)}></template>`;
            }

            return `<template data-directive="core-component" ${attrStr.slice(10)}></template>`;
        }
        const marker_id = `${directive}-${makeId(8)}`;
        const component = { import_id: imported_component_id, tag, attrStr, slot_node: createNodes(slot_content) || [] };
        markedNodeCache.set(marker_id, component);

        return `<template data-import-id="${imported_component_id}" data-directive="${directive}" data-marker-id="${marker_id}"></template>`;
    })

    return template;
}
