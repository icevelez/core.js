import { getContext, load, onMount, setContext } from "../../core/core.js";
import { component } from "../../core/parser/handlebar.js";
import { createSignal } from "../../core/reactivity.js";

import TestComponent from "../components/TestComponent.js";
import ExampleSub from "../components/ExampleSub.js";
import Comp from "../components/Comp.js";

export default component({
    template: await load("src/pages/Playground.html"),
    components: {
        TestComponent,
        ExampleSub,
        Comp,
    }
}, class {

    welcome = (message) => {
        console.log(message);
        return () => {
            console.log("cleaning up welcome message");
        }
    }

    name = getContext('name');
    counter = getContext('counter');
    names = createSignal(['ice', 'ian', 'takeru', 'piox']);

    constructor() {
        console.log("HELLO");

        setContext('name', 'new name set by playground component');

        onMount(() => {
            console.log("render playground");
        });
    }

    addName = (event) => {
        if (event.key !== "Enter") return;
        this.names().push(event.target.value)
        event.target.value = "";
    }
});
