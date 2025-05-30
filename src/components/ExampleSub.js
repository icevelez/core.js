import { onMount, onUnmount } from "../../core/core.js";
import { component } from "../../core/template-engine/handlebar.js";

export default component({
    template: `
        <h1>Hello from Example Sub</h1>
    `
}, class {

    constructor() {
        onMount(() => console.log("mount from ExampleSub"))
        onUnmount(() => console.log("unmount from ExampleSub"))
    }
});
