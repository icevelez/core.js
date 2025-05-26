import { makeId } from "../core/helper-functions.js";
import { State, effect } from "../core/reactivity.js";

const map = new State(new Map());
const date = new State(new Date());
const url = new State(new URL(window.location));

map.value.set("item", makeId(24));

effect(() => {
    console.log("Map item", map.value.get("item"));
    console.log("Year:", date.value.getFullYear());
})

// setInterval(() => {
//     date.value.setFullYear(date.value.getFullYear() + 1)
//     map.value.set("item", makeId(24));
//     console.log("changed")
// }, 2000)
