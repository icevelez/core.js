import { load } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { State } from "../core/reactivity.js";

import AppModule from "./App.module.js";

export default component({
    template: await load("src/App.html"),
    components: {},
}, class {

    AppModule = AppModule;

    counter = new State(0);
    name = new State('User');

    constructor() { }

});
