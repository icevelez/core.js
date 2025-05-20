import { onMount, onUnmount } from "../../core/core.js";
import { effect, State } from "../../core/reactivity.js";
import { component } from "../../core/template-engine/handlebar.js";

export default component({
    template: "<h1>Test Comp!</h1>"
}, class {

    count = new State(0);

    constructor() {

        effect(() => {
            console.log("count outer", this.count.value);

            effect(() => {
                console.log("count inner", this.count.value);

                return () => {
                    console.log("disposing effect inner")
                }
            })

            return () => {
                console.log("disposing effect outer")
            }
        })

        onMount(() => {
            console.log("mounting TestComponent");
        })
        onUnmount(() => {
            console.log("unmounting TestComponent");
        })
    }
});
