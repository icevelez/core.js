import { load, onMount, onUnmount } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { State } from "../core/reactivity.js";

import TestComponent from "./components/TestComponent.js";
import ExampleSub from "./components/ExampleSub.js";

export default component({
    template: await load("src/App.html"),
    components: {
        TestComponent,
        ExampleSub,
    }
}, class {

    data = new State({ deep: { deeper: { deepest: { user: "User!", counter: 0, names: ['ice', 'ian', 'takeru', 'piox'] } } } });
    // data = new State({ deep: { deeper: { deepest: { user: "User!", counter: 0, names: ['ice', 'ian', 'takeru', 'piox'].map((i) => ({ name: i })) } } } });

    constructor() {
        onMount(() => {
            console.log("mounting App")
        })

        onUnmount(() => {
            console.log("unmounting App")
        })
    }
});
