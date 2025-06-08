import { onMount, onUnmount } from "../../core/core.js";
import { effect, State } from "../../core/reactivity.js";
import { component } from "../../core/template-engine/handlebar.js";

export default component({
    template: `
        <h1>Hello from {{ name.value }}</h1>
        <Core:slot/>
    `
}, class {

    name = new State("EXAMPLE SUB");

    constructor() {
        onMount(() => console.log("mount from ExampleSub"))
        onUnmount(() => console.log("unmount from ExampleSub"))
    }
});
