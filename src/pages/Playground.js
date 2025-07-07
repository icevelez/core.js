import { getContext, load, onMount, onUnmount, setContext } from "../../core/core.js";
import { component } from "../../core/handlebar.js";
import { createSignal } from "../../core/reactivity.js";

import TestComponent from "../components/TestComponent.js";
import ExampleSub from "../components/ExampleSub.js";

export default component({
    template: await load("src/pages/Playground.html"),
    components: {
        TestComponent,
        ExampleSub,
    }
}, class {

    names = createSignal(['ice', 'ian', 'takeru', 'piox'].map(n => ({ name: n })));

    counter = getContext('root-app');

    constructor() {
        setContext('root-app', 'not counter');
    }

    addName = (event) => {
        if (event.key !== "Enter") return;

        this.names().push({ name: event.target.value })
        event.target.value = "";
    }
});
