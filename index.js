import { mount } from './core/core.js';
import App from './src/App.js';

mount(App, { target: document.getElementById('app') });

// import { createSignal, effect } from "./core/reactivity.js";

// const names = createSignal([]);

// effect(() => {
//     console.log(names());
// })

// setTimeout(() => {
//     names()[0] = 'ice';
//     console.log("update");
// }, 1000);
