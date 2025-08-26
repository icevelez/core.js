import { onMount } from "../../core/core.js";
import { createSignal, effect } from "../../core/reactivity.js";
import { component } from "../../core/handlebar.js";

export default component({
    template: `
        <h1>Hello from Test Component! {{ name() }}</h1>
        <input type="text" bind:value="name">
    `,
}, class {

    name = createSignal("TestComponent");

    constructor() {
        onMount(() => {
            console.log("render test-component");
        })
    }

});
