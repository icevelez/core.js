import { load, onMount } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { State } from "../core/reactivity.js";

export default component({
    template: await load("src/App.html"),
    components: {},
}, class {

    todos = new State([
        { title: 'alice', completed: false },
        { title: 'bob', completed: false },
        { title: 'matt', completed: false },
        { title: 'nikko', completed: false },
        { title: 'ralph', completed: false },
        { title: 'ian', completed: false }
    ]);

    constructor() {

        setTimeout(() => {
            const x = this.todos.value[1];
            this.todos.value[1] = this.todos.value[4];
            this.todos.value[4] = x;
            console.log("SWAP");
        }, 5000);
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
