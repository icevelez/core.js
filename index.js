// import { mount } from './core/core.js';
// import App from './src/App.js';

// mount(App, { target: document.getElementById('app') })

import { processNode } from "./core/template-engine/x-attr.js";

const template = `
    <ul>
        <li x-each="items as item">{{ item.name }}</li>
    </ul>
`;

const div = document.createElement("div");
div.innerHTML = template;

const fragment = document.createDocumentFragment();

for (const child of Array.from(div.childNodes)) {
    processNode(child, fragment, {});
}
