import { getContext, onMount, onUnmount } from "../../core/core.js";
import { createSignal, effect } from "../../core/reactivity.js";
import { component } from "../../core/template-engine/handlebar.js";

export default component({
    template: `
        <h1>Hello from Test Component! {{ name() }}</h1>
        <input type="text" bind:value="name">
    `,
}, class {

    name = createSignal("TestComponent");

    constructor() {
        console.log("ON RENDER test component context:", getContext('root-app'));

        effect(() => {
            console.log("effect run from TestComponent");

            return () => {
                console.log("clean up effect inside TestComponent");
            }
        });

        onMount(() => {
            console.log("mount from TestComponent");
            console.log("ON MOUNT test component context:", getContext('root-app'));
        });

        onUnmount(() => console.log("unmount from TestComponent"))
    }
});
