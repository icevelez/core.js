import { addBlockToCache, addComponentImports, compileTemplate } from "../runtime.js";
import { makeId } from "../helper-functions.js";
import { contextWrapper, mountWrapper } from "../internal.js";

/**
* @param {{ template : string, components : Record<string, Function> }} options
* @param {Object} Ctx anonymous class that encapsulate data and logic
* @returns {(anchor:Node, props:Record<string, any>) => () => void}
*/
export function component(options, Ctx = class { }) {
    if (Ctx && !Ctx.toString().startsWith("class")) throw new Error("context is not a class");

    const components_id = makeId(6);
    const template = processComponents(options.template, components_id);
    const template_fn = compileTemplate(parseHandlebar(template));

    if (options.components && Object.keys(options.components).length > 0) addComponentImports(components_id, options.components);

    return (anchor, props) => mountWrapper(() => contextWrapper(() => template_fn(anchor, !Ctx ? {} : new Ctx(props))))
}

function parseHandlebar(source) {
    const blockPattern = /{{#(await|if|each)(\b[^}]*)?}}|{{\/(await|if|each)}}/g;
    const stack = [], blocks = [];
    let match;

    while ((match = blockPattern.exec(source))) {
        const [full, openName, openArgs, closeName] = match;
        if (openName) {
            stack.push({
                name: openName,
                start: match.index,
                end: null
            });
        } else if (closeName) {
            const last = stack.pop();
            if (!last || last.name !== closeName) throw new Error(`Unbalanced block: expected {{/${last?.name}}} but found {{/${closeName}}}`);
            last.end = match.index + full.length;
            last.outer = source.slice(last.start, last.end);
            blocks.push(last);
        }
    }

    blocks.sort((a, b) => b.start - a.start);

    let html = source;
    for (const block of blocks) {
        const block_id = `${block.name}-${makeId(6)}`;
        const placeholder = `<template data-block="${block.name}" data-block-id="${block_id}"></template>`;
        html = html.slice(0, block.start) + placeholder + html.slice(block.end);
        addBlockToCache(block_id, parse[block.name](block.outer));
    }

    return html;
}

const RE = {
    each: /{{#each\s+(.+?)\s+as\s+((?:\w+|\{[\s\S]*?\}|\([\s\S]*?\)))\s*(?:,\s*(\w+))?}}([\s\S]*?){{\/each}}/g,
    if: /{{#if\s+(.+?)}}([\s\S]*?){{\/if}}/g,
    else: /{{:else\s+if\s+(.+?)}}|{{:else}}/g,
    await: /{{#await\s+(.+?)}}([\s\S]*?){{\/await}}/g,
    then: /\{\{:then(?:\s+(\w+))?\}\}([\s\S]*?)(?={{:|$)/,
    catch: /\{\{:catch(?:\s+(\w+))?\}\}([\s\S]*?)(?={{:|$)/,
    blockSplit: /{{:then[\s\S]*?}}|{{:catch[\s\S]*?}}/,
    component: /<([A-Z][A-Za-z0-9]*)\s*((?:[^>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>(?:([\s\S]*?)<\/\1>)?/g,
};

const parse = {
    if: function (block) {
        RE.if.lastIndex = 0;
        const match = RE.if.exec(block);
        if (!match) throw new Error("parsing error on \"if\" block");

        const [, firstCond, firstBody] = match, exprs = [], fns = [];
        let lastCond = firstCond, lastIndex = 0, m;

        while ((m = RE.else.exec(firstBody))) {
            if (m.index > lastIndex) {
                exprs.push(lastCond);
                fns.push(compileTemplate(parseHandlebar(firstBody.slice(lastIndex, m.index))))
            }
            if (m[0].startsWith("{{:else if")) {
                lastCond = m[1];
                lastIndex = m.index + m[0].length;
            } else {
                exprs.push("true");
                fns.push(compileTemplate(firstBody.slice(m.index + m[0].length)))
                lastIndex = firstBody.length;
                break;
            }
        }

        if (lastIndex < firstBody.length) {
            exprs.push(lastCond);
            fns.push(compileTemplate(firstBody.slice(lastIndex)))
        }

        return { fns, exprs };
    },
    each: function (block) {
        RE.each.lastIndex = 0;
        const match = RE.each.exec(block);
        if (!match) throw new Error("parsing error on \"each\" block")

        const [, expr, blockVar, indexVar, content] = match,
            parts = content.split(/{{:empty}}/),
            trimmedVar = blockVar.trim();

        return {
            expr: expr.trim(),
            fn: parts[0] ? compileTemplate(parts[0]) : undefined,
            else_fn: parts[1] ? compileTemplate(parts[1]) : undefined,
            key: trimmedVar,
            keys: trimmedVar.startsWith("{") || trimmedVar.startsWith("[") ? trimmedVar.slice(1, -1).split(",").map(v => v.trim()) : [],
            index_key: indexVar?.trim() || "",
        };
    },
    await: function (block) {
        RE.await.lastIndex = RE.then.lastIndex = RE.catch.lastIndex = RE.blockSplit.lastIndex = 0;
        const match = RE.await.exec(block);
        if (!match) throw new Error("parsing error on \"await\" block");

        const [, promiseExpr, content] = match,
            thenMatch = RE.then.exec(content),
            catchMatch = RE.catch.exec(content),
            pending = content.split(RE.blockSplit)[0] || "";

        return {
            expr: promiseExpr.trim(),
            pending_fn: pending ? compileTemplate(pending) : undefined,
            then_fn: thenMatch && thenMatch[2] ? compileTemplate(thenMatch[2]) : undefined,
            then_key: thenMatch && thenMatch[1] || undefined,
            catch_fn: catchMatch && catchMatch[2] ? compileTemplate(catchMatch[2]) : undefined,
            catch_key: catchMatch && catchMatch[1] || undefined,
        };
    },
}

/**
* Replaces all custom HTML Tags with a placeholder element to be processed later
* @param {string} template
* @param {number} imported_component_id
*/
function processComponents(template, imported_component_id) {
    RE.component.lastIndex = 0;
    return template.replace(RE.component, (match, tag, attrStr, _) => {
        const props = {}, dynamic_props = [], props_id = `props-${makeId(8)}`;

        attrStr.replace(/([\w:@-]+)(?:\s*=\s*"([^"]*)")?/g, (_, key, value) => {
            if (value && value.startsWith('{{')) {
                dynamic_props.push({ key, expr: value.match(/^{{\s*(.+?)\s*}}$/)[1] });
            } else if (value) {
                props[key] = value;
            }
        })

        addBlockToCache(props_id, { props, dynamic_props });

        if (match.startsWith("<Core:component")) {
            const _default = props.default;
            delete props.default;
            return `<template data-block="core-component" data-block-props-id="${props_id}" data-component="${_default}"></template>`;
        }

        return `<template data-block="component" data-component-tag="${tag}" data-component-id="${imported_component_id}" data-block-props-id="${props_id}"></template>`;
    })
}
