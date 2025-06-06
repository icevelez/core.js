import { load, onMount, onUnmount } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { effect, State } from "../core/reactivity.js";

import { Router } from "./common/router.js";

import TestComponent from "./components/TestComponent.js";
import ExampleSub from "./components/ExampleSub.js";
import Benchmark from "./pages/Benchmark.js";

export default component({
    template: await load("src/App.html"),
    components: {
        TestComponent,
        ExampleSub,
        Benchmark,
    }
}, class {

    Router = Router;
    use_benchmark = new State(false);

    counter = new State(0);
    user = new State("User!");
    date = new State();
    names = new State(['ice', 'ian', 'takeru', 'piox']);

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

        this.names.value.push(event.target.value)
        event.target.value = "";
    }
});
