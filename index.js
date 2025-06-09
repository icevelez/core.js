import { mount } from './core/core.js';

import App from './src/App.js';
import AppModule from "./src/App.module.js";

mount(App, {
    target: document.getElementById('app'),
    modules: AppModule,
})
