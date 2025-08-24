import { load, setContext } from "../core/core.js";
import { component } from "../core/handlebar.js";
import { createDerived, createSignal } from "../core/reactivity.js";

import { Router } from "./common/router.js";

export default component({
    template: await load("src/App.html"),
    components: {},
}, class {

    Router = Router;

    counter = createSignal(0);
    double = createDerived(() => this.counter() * 2);

    name = createSignal('User');

    constructor() {
        console.log("render app");
        setContext('root-app', this.counter);
    }
});
