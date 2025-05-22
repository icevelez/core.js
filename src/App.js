import { load, onMount } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { State } from "../core/reactivity.js";

import TestComponent from "./components/TestComponent.js";

export default component({
    template: await load("src/App.html"),
    components: {
        TestComponent,
    }
}, class {

    name = new State("User!");

    counter = new State(0);

    constructor() {
        onMount(() => {
            console.log("mounting App")
        })
    }
});
