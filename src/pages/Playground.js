import { load, onMount, onUnmount } from "../../core/core.js";
import { component } from "../../core/template-engine/handlebar.js";
import { State } from "../../core/reactivity.js";

import TestComponent from "../components/TestComponent.js";
import ExampleSub from "../components/ExampleSub.js";

export default component({
    template: await load("src/pages/Playground.html"),
    components: {
        TestComponent,
        ExampleSub,
    }
}, class {

    names = new State(['ice', 'ian', 'takeru', 'piox']);

    constructor() {
        onMount(() => {
            console.log("mounting Playground")
        })

        onUnmount(() => {
            console.log("unmounting Playground")
        })
    }

    addName = (event) => {
        if (event.key !== "Enter") return;

        this.names.value.push(event.target.value)
        event.target.value = "";
    }
});
