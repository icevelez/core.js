import { onMount, onUnmount } from "../../core/core.js";
import { component } from "../../core/template-engine/handlebar.js";

export default component({
    template: `
        <h1>Greetings Another Component</h1>
    `,
    components: {},
}, class {

    message = "Greetings from Another!";

    constructor(attr) {
        onMount(() => {
            console.log("onMount Another.js", attr);
        })

        onUnmount(() => {
            console.log("onUnmount Another.js", attr);
        });
    }
});
