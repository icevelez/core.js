import { load, onMount, onUnmount } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { State } from "../core/reactivity.js";

import Greetings from "./components/Greetings.js";
import TestComponent from "./components/TestComponent.js";

export default component({
    template: await load("src/App.html"),
    components: {
        Greetings,
        TestComponent,
    }
}, class {

    hide_names = new State(false);
    test_arr = new State([]);
    name = new State("User!");
    names = new State(['Ice', 'Takeru', 'Ian']);

    counter = new State(0)

    constructor() {

        onMount(() => {
            console.log("mounting App")
        })

        onUnmount(() => {
            console.log("unmounting App")
        })
    }

    addName = (event) => {
        if (event.key !== "Enter") return;
        this.names.value.push(event.target.value);
        event.target.value = "";
    }
});
