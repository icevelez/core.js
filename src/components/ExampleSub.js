import { getContext, onMount, onUnmount } from "../../core/core.js";
import { createSignal } from "../../core/reactivity.js";
import { component } from "../../core/handlebar.js";

export default component({
    template: `
        <h1>Hello from {{ name() }}</h1>
        <Core:slot/>
    `
}, class {

    name = createSignal("");

    constructor() {
        this.name.set(getContext('root-app'));
    }
});
