import { onMount, onUnmount } from "../../core/core.js";
import { effect, State } from "../../core/reactivity.js";
import { component } from "../../core/template-engine/handlebar.js";

export default component({
    template: `
        <h1>Hello from Test Component! {{ name.value }}</h1>
        <input type="text" bind:value="name.value">
    `,
}, class {

    name = new State("TestComponent");

    constructor() {

        effect(() => {
            console.log("effect run from TestComponent");

            return () => {
                console.log("clean up effect inside TestComponent");
            }
        });

        onMount(() => console.log("mount from TestComponent"))
        onUnmount(() => console.log("unmount from TestComponent"))
    }
});
