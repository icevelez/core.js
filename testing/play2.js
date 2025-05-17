
import { State, effect } from "./framework/reactivity2.js";

function test_nestedEffect() {
    const outer = new State(0);
    const inner = new State(100);

    effect(() => {
        console.log('Outer Effect:', outer.value);

        effect(() => {
            console.log('  Inner Effect:', inner.value);
        });
    });

    console.log('--- First update ---');
    outer.value = 1;

    setTimeout(() => {
        console.log('--- Second update ---');
        inner.value = 200;

        setTimeout(() => {
            console.log('--- Third update ---');
            outer.value = 2;

            setTimeout(() => {
                console.log('--- Forth update ---');
                inner.value = 300;
            })
        })
    })

    setInterval(() => {
        outer.value = outer.value + 1;
    }, 1000)

    setInterval(() => {
        inner.value = outer.value + 1;
    }, 1200)
}

function test_deepProxy() {
    const object = new State([
        { name: "ice" },
        { name: "bob" },
        { name: "alex" },
    ]);

    effect(() => {
        console.log('object', object.value)
    })

    effect(() => {
        console.log('1', object.value[1])
    })

    effect(() => {
        console.log('2 name', object.value[2].name)
    })

    effect(() => {
        console.log('length', object.value.length)
    })

    setTimeout(() => {
        console.log("update");
        object.value.push({ name: "nora" });
    }, 1000)
}

test_deepProxy();
