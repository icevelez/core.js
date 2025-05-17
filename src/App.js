import { load, onMount } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { State } from "../core/reactivity.js";

export default component({
    template: await load("src/App.html"),
    components: {},
}, class {

    todos = new State([
        { title: 'test', completed: false }
    ]);

    constructor(props) {

        onMount(() => {
            console.clear();
        })
    }

    addTodo = (event) => {
        if (event.key !== "Enter") return;
        this.todos.value.push({ title: event.target.value, completed: false });
        event.target.value = "";
    }

    removeTodo = (i) => {
        this.todos.value.splice(i, 1);
    }
});
