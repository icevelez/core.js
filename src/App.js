import { load, onMount } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { State } from "../core/reactivity.js";
import Example from "./components/Example.js";

export default component({
    template: await load("src/App.html"),
    components: {
        Example,
    },
}, class {

    showList = new State(true);

    todos = new State([
        { title: 'alice', completed: false },
        { title: 'bob', completed: false },
        { title: 'matt', completed: false },
        { title: 'nikko', completed: false },
        { title: 'ralph', completed: false },
        { title: 'ian', completed: false }
    ]);

    constructor() {
        onMount(() => {
            console.log("===============================")
        })
    }

    addTodo = (event) => {
        if (event.key !== "Enter") return;
        this.todos.value.push({ title: event.target.value, completed: false });
        event.target.value = "";
    }

    removeTodo = (i) => {
        console.log(i, 'removing');

        this.todos.value.splice(i, 1);
    }
});
