import { onMount, onUnmount } from "../../core/core.js";
import { createSignal } from "../../core/reactivity.js";
import { component } from "../../core/template-engine/handlebar.js";

export default component({
    template: `
        <h1>Hello from {{ name() }}</h1>
        <Core:slot/>
    `
}, class {

    name = createSignal("EXAMPLE SUB");

    constructor() {
        onMount(() => console.log("mount from ExampleSub"))
        onUnmount(() => console.log("unmount from ExampleSub"))
    }
});
