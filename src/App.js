import { load } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { State } from "../core/reactivity.js";

import { Router } from "./common/router.js";

export default component({
    template: await load("src/App.html"),
    components: {},
}, class {

    Router = Router;

    counter = new State(0);
    name = new State('User');

    constructor() {

    }
});
