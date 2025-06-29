import { load } from "../../core/core.js";
import { component } from "../../core/template-engine/handlebar.js";
import { createSignal, effect } from "../../core/reactivity.js";

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

    // count = createSignal(0);
    // getName = () => {
    //     console.log("get name")
    //     return "Jonas"
    // }

    constructor() {
        setTimeout(() => {
            this.runLots();
            console.log("X");
        }, 2000)

        // setTimeout(() => {
        //     this.count.set(this.count()+1);
        //     console.log("count update");
        // }, 1000);
    }

    data = createSignal([]);
    selected = createSignal(null);

    add = () => {
        console.time('add');
        this.data.set([...this.data(), ...buildData(1000)])
        requestAnimationFrame(() => {
            console.timeEnd('add');
        });
    }

    clear = () => {
        console.time('clear');
        this.data.set([])
        requestAnimationFrame(() => {
            console.timeEnd('clear');
        });
    };

    partialUpdate = () => {
        console.time('partial update');
        for (let i = 0; i < this.data().length; i += 10) {
            const row = this.data()[i];
            row.label = row.label + ' !!!';
        }
        requestAnimationFrame(() => {
            console.timeEnd('partial update');
        });
    };

    remove = (row) => {
        console.time('remove');
        this.data().splice(this.data().indexOf(row), 1);
        requestAnimationFrame(() => {
            console.timeEnd('remove');
        });
    };

    run = () => {
        console.time('run');
        this.data.set(buildData(1000))
        requestAnimationFrame(() => {
            console.timeEnd('run');
        });
    };

    runLots = () => {
        // const n = (new Date()).getTime()

        console.time('runLots');
        this.data.set(buildData(10000))

        requestAnimationFrame(() => {
            console.timeEnd('runLots');
            // const e = (new Date()).getTime()
            // alert(`${e - n}ms`);
        })
    };

    swapRows = () => {
        const tmp = this.data();
        if (tmp < 998) return;

        const a = tmp[1];
        tmp[1] = tmp[998];
        tmp[998] = a;

        this.data.set(tmp);
    };

});
