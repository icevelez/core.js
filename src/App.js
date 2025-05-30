import { load, onMount, onUnmount } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { createDerived, createState } from "../core/reactivity.js";

import TestComponent from "./components/TestComponent.js";
import ExampleSub from "./components/ExampleSub.js";

export default component({
    template: await load("src/App.html"),
    components: {
        TestComponent,
        ExampleSub,
    }
}, class {

    outer = true;
    inner = false;
    inner_inner = true;
    inner_inner_else = true;
    outer_sibling = true;

    data = createState({ deep: { deeper: { deepest: { user: "User!", counter: 0, names: ['ice', 'ian', 'takeru', 'piox'] } } } });
    double = createDerived(() => this.data().deep.deeper.deepest.counter * 2);

    constructor() {
        onMount(() => {
            console.log("mounting App")
        })

        onUnmount(() => {
            console.log("unmounting App")
        })
    }

    addName = (event) => {
        if (event.key !== "Enter") return;

        this.data().deep.deeper.deepest.names.push(event.target.value)
        event.target.value = "";
    }
});
