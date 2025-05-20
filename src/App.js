import { load } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { State } from "../core/reactivity.js";

export default component({
    template: await load("src/App.html"),
    components: {}
}, class {

    name = "Developer!"

    counter = new State(0)

    constructor() { }

    increment = () => {
        this.counter.value++
    }
});
