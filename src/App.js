import { load, onMount } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { Derived, State } from "../core/reactivity.js";

import Example from "./components/Example.js";

export default component({
    template: await load("src/App.html"),
    components: {
        Example,
    }
}, class {

    see = (node, attr) => {
        console.log("hello from see func", { node, attr });

        return () => {
            console.log("unmounting see");
        }
    }

    comp_name = new State("Example");

    promise = new Derived(() => import(`./components/${this.comp_name.value}.js`))

    showList = new State(true);

    todos = new State([
        { title: 'alice', completed: false },
        { title: 'bob', completed: true },
        { title: 'matt', completed: false },
        { title: 'nikko', completed: false },
        { title: 'ralph', completed: false },
        { title: 'ian', completed: false }
    ]);

    constructor() {
        onMount(() => {
            console.log("===============================")
        })

        setTimeout(() => {
            this.comp_name.value = "Another";
        }, 5000)
    }

    addTodo = (event) => {
        if (event.key !== "Enter") return;
        this.todos.value.push({ title: event.target.value, completed: false });
        event.target.value = "";
    }

    removeTodo = (i) => {
        console.log(i, 'x removing');
        this.todos.value.splice(i, 1);
    }
});
