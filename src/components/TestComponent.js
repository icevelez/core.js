import { onMount, onUnmount } from "../../core/core.js";
import { component } from "../../core/template-engine/handlebar.js";

export default component({
    template: "<h1>Greetings!</h1>"
}, class {

    constructor() {
        onMount(() => {
            console.log("mounting TestComponent");
        })
        onUnmount(() => {
            console.log("unmounting TestComponent");
        })
    }
});
