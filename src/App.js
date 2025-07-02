import { load, setContext } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { createDerived, createSignal } from "../core/reactivity.js";

import { Router } from "./common/router.js";
import TestComponent from "./components/TestComponent.js";

export default component({
    template: await load("src/App.html"),
    components: {
        TestComponent,
    },
}, class {

    Router = Router;

    counter = createSignal(0);
    double = createDerived(() => this.counter() * 2);

    name = createSignal('User');

    constructor() {
        setContext('root-app', 'hello from root');
        console.log("SET ROOT CONTEXT")
    }

});
