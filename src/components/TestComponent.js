import { getContext, onMount, onUnmount, setContext } from "../../core/core.js";
import { createSignal, effect } from "../../core/reactivity.js";
import { component } from "../../core/template-engine/handlebar.js";

export default component({
    template: `
        <h1>Hello from Test Component! {{ name() }}</h1>
        <input type="text" bind:value="name">
        {{#await import("/src/App.js")}}
            <h1>Loading App</h1>
        {{:then App}}
            <Core:component default="App"/>
        {{/await}}
    `,
}, class {

    name = createSignal("TestComponent");

    constructor() { }

});
