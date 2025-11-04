import { createSignal } from "../core-next/reactivity.js";
import { makeId } from "../core/helper-functions.js";
import { component } from "../core-next/parser/handlebar.js";
import { onMount } from "../core-next/core.js";

const example_component = component({
    template: `
        <div style="display: flex; gap: 1rem;">
            <h1>Fullfilled {{ example }}</h1>
        </div>
    `,
}, class {

    constructor(props) {
        onMount(() => {
            console.log("BRUH 2");
        })

        this.example = props.message
    }
});

const layout = component({
    template: `
        <button onclick="{{() => is_showing.set(!is_showing())}}">Click Me</button>
        {{#if is_showing()}}
            <Core:component default="example" message="{{ count() * 2 }}"/>
        {{/if}}
    `
}, class {

    count = createSignal(0);
    is_showing = createSignal(true);

    example = example_component;

    constructor() {
        onMount(() => {
            console.log("BRUH 1");
        })

        setTimeout(() => {
            this.count.set(this.count() + 1);
        }, 3000)
    }
})

const app = document.getElementById("app");

layout(app)
