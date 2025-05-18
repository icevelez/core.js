import { onMount, onUnmount } from "../../core/core.js";
import { component } from "../../core/template-engine/handlebar.js";

export default component({
    template: `
        {{ message }}
        <Slot/>
    `,
    components: {},
}, class {

    message = "Hello World";

    constructor(prop) {
        onMount(() => {
            console.log("onMount Example.js", prop);
        })

        onUnmount(() => {
            console.log("onUnmount Example.js 1", prop);
        });
    }
});
