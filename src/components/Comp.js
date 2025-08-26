import { getContext, onMount } from "../../core/core.js";
import { createSignal } from "../../core/reactivity.js";
import { component } from "../../core/handlebar.js";

export default component({
    template: `
    <div>
        <h1>{{ i()+1 }}. {{name().toUpperCase() }}</h1>
        <button onclick="{{ () => { names().splice(i(), 1); } }}">Delete</button>
        <input type="text" bind:value="names()[i()]">
    </div>
    `
}, class {

    constructor(props) {
        this.names = props.names;
        this.i = props.i;
        this.name = props.name;

        onMount(() => {
            console.log("render comp");
        });
    }
});
