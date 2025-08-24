import { getContext, load, setContext } from "../../core/core.js";
import { component } from "../../core/handlebar.js";
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

    counter = getContext('root-app');
    names = createSignal(['ice', 'ian', 'takeru', 'piox']);

    constructor() {
        console.log("render playground");
        setContext('root-app', 'not counter');
    }

    addName = (event) => {
        if (event.key !== "Enter") return;
        this.names().push(event.target.value)
        event.target.value = "";
    }
});
