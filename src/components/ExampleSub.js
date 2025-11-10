import { getContext, onMount } from "../../core/core.js";
import { createSignal } from "../../core/reactivity.js";
import { component } from "../../core/parser/handlebar.js";

export default component({
    template: `
        <h1>Hello from {{ name() }}</h1>
        <Core:slot/>
    `
}, class {

    name = createSignal("");

    constructor(props) {
        this.child = props.child;
        this.name.set(getContext('name'));

        onMount(() => {
            console.log("render example-sub");
        })
    }
});
