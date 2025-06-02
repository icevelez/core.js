import { load } from "../../core/core.js";
import { component } from "../../core/template-engine/handlebar.js";
import { State } from "../../core/reactivity.js";

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

export default component({
    template: await load("src/pages/Benchmark.html"),
    components: {}
}, class {

    constructor() { }

    data = new State([]);
    selected = new State(null);

    add = () => this.data.value.push(...buildData(1000))

    clear = () => {
        this.data.value = [];
    };

    partialUpdate = () => {
        for (let i = 0; i < this.data.value.length; i += 10) {
            const row = this.data.value[i];
            row.label = row.label + ' !!!';
        }
    };

    remove = (row) => {
        this.data.value.splice(clone.indexOf(row), 1);
    };

    run = () => {
        this.data.value = buildData(1000);
    };

    runLots = () => {
        this.data.value = buildData(10000);
    };

    swapRows = () => {
        if (this.data.value.length < 998) return;
        const tmp = this.data.value[1];
        this.data.value[1] = this.data.value[998];
        this.data.value[998] = tmp;
    };

});
