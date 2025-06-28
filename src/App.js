import { load } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { Derived, State } from "../core/reactivity.js";

import { Router } from "./common/router.js";

export default component({
    template: await load("src/App.html"),
    components: {},
}, class {

    Router = Router;

    counter = new State(0);
    double = new Derived(() => this.counter.value * 2);
    isEven = new Derived(() => this.double.value % 2 === 0);
    name = new State('User');

    constructor() { }

});
