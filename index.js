import App from "./src/App.js"

App(document.getElementById("app"));

// import { component } from "./core/parser/x-directive.js";
// import { createSignal } from "./core/reactivity.js";

// const App = component({
//     template: `
//         <h1>Hello {{ message }}</h1>
//         <button onclick="{{ () => is_showing.set(!is_showing()) }}">Click Me</button>
//         <template x-if="is_showing()">
//             <h1>Another conditional rendering</h1>
//             <p>Fragment</p>
//         </template>

//         <div>
//             <template x-for="items()" x-key="item" x-index="i">
//                 <h1>{{ i + 1 }} {{ item() }}</h1>
//                 <input bind:value="items()[i]">
//                 <button onclick="{{ () => items().splice(i, 1) }}">Delete</button>
//             </template>
//         </div>
//     `,
// }, class {

//     message = "World";
//     is_showing = createSignal(false);

//     items = createSignal([
//         "Ice",
//         "Sean",
//         "Keanu",
//         "JD",
//         "Stephen",
//         "Toshi",
//     ]);

//     constructor() { }

// });

// App(document.getElementById("app"))
