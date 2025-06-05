import { makeId } from "../core/helper-functions.js";
import { State, effect } from "../core/reactivity.js";

// const object = createStore([
//     {
//         name: [
//             'ice'
//         ]
//     },
//     {
//         name: [
//             'hello world'
//         ]
//     },
// ]);

// effect(() => {
//     console.log('object:', object);
// });

// effect(() => {
//     console.log('object zero:', object[0]);
// });

// effect(() => {
//     console.log('object zero name:', object[0].name);
// });

// effect(() => {
//     console.log('object zero name zero:', object[0].name[0]);
// });

// setTimeout(() => {
//     const tmp = object[1].name;
//     object[1].name = object[0].name;
//     object[0].name = tmp;

//     console.log("update")
// })

// const map = new State(new Map());
// const date = new State(new Date());
// const url = new State(new URL(window.location));

// map.value.set("item", makeId(24));

// effect(() => {
//     console.log("Map item", map.value.get("item"));
//     console.log("Year:", date.value.getFullYear());
// })

// setInterval(() => {
//     date.value.setFullYear(date.value.getFullYear() + 1)
//     map.value.set("item", makeId(24));
//     console.log("changed")
// }, 2000)


let rowId = 1;

const adjectives = [
    'pretty',
    'large',
    'big',
    'small',
    'tall',
    'short',
    'long',
    'handsome',
    'plain',
    'quaint',
    'clean',
    'elegant',
    'easy',
    'angry',
    'crazy',
    'helpful',
    'mushy',
    'odd',
    'unsightly',
    'adorable',
    'important',
    'inexpensive',
    'cheap',
    'expensive',
    'fancy'
];
const colours = [
    'red',
    'yellow',
    'blue',
    'green',
    'pink',
    'brown',
    'purple',
    'brown',
    'white',
    'black',
    'orange'
];
const nouns = [
    'table',
    'chair',
    'house',
    'bbq',
    'desk',
    'car',
    'pony',
    'cookie',
    'sandwich',
    'burger',
    'pizza',
    'mouse',
    'keyboard'
];

function _random(max) {
    return Math.round(Math.random() * 1000) % max;
}

class Item {
    id = rowId++;
    label = `${adjectives[_random(adjectives.length)]} ${colours[_random(colours.length)]} ${nouns[_random(nouns.length)]}`;
}

function buildData(count = 1000) {
    const data = new Array(count);
    for (let i = 0; i < count; i++) {
        data[i] = new Item();
    }
    return data;
}

const data = new State([]);

effect(() => {
    console.log(data.value.length);
})

const runLots = () => {
    data.value = buildData(10000);
    console.log("run lots");
};

const clear = () => {
    data.value = [];
    console.log("clear");
};

window.__play = {
    clear,
    runLots,
}
