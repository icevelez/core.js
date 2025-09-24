import { load, onMount, setContext } from "../core/core.js";
import { component } from "../core/handlebar.js";
import { createDerived, createSignal } from "../core/reactivity.js";

import { Router } from "./common/router.js";

export default component({
    template: await load("src/App.html"),
    components: {},
}, class {

    Router = Router;

    isDisabled = createSignal(true);

    counter = createSignal(0);
    double = createDerived(() => this.counter() * 2);

    name = createSignal('User');

    constructor() {
        setContext('counter', this.counter);
        setContext('name', this.name);

        onMount(() => {
            console.log("render app");
        })
    }
});
