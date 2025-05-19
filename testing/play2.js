
import { Derived, State, effect } from "../core/reactivity.js";

// function test_nestedEffect() {
//     const outer = new State(0);
//     const inner = new State(100);
//     const much_inner = new State(9999);
//     const super_inner = new State(55555);

//     const unsub = effect(() => {
//         console.log('Outer Effect:', outer.value);

//         effect(() => {
//             console.log('  Inner Effect:', inner.value);

//             effect(() => {
//                 console.log('      Much #1 Effect:', much_inner.value);
//             });
//             effect(() => {
//                 console.log('      Much #1.2 Effect:', much_inner.value);
//             });
//         });

//         effect(() => {
//             console.log('      Much #0 Effect:', much_inner.value);
//         });
//         effect(() => {
//             console.log('          Super Inner Effect:', super_inner.value);
//         });
//     });

//     console.log('--- First update ---');
//     outer.value = 1;

//     setTimeout(() => {
//         console.log('--- Second update ---');
//         inner.value = 200;

//         setTimeout(() => {
//             console.log('--- Third update ---');
//             outer.value = 2;

//             setTimeout(() => {
//                 console.log('--- Forth update ---');
//                 inner.value = 300;
//             })
//         })
//     })

//     setTimeout(() => {
//         unsub();
//         console.log("unsubscribe");
//     }, 1000);

//     setInterval(() => {
//         outer.value = outer.value + 1;
//     }, 1000)

//     setInterval(() => {
//         inner.value = outer.value + 1;
//     }, 1200)
// }

// test_nestedEffect();

// function test_deepProxy() {
//     const object = new State([
//         { name: "ice" },
//         { name: "bob" },
//         { name: "alex" },
//     ]);

//     effect(() => {
//         console.log('object', object.value)
//     })

//     effect(() => {
//         console.log('0', object.value[0])
//     })

//     effect(() => {
//         console.log('1', object.value[1])
//     })

//     effect(() => {
//         console.log('2 name', object.value[2].name)
//     })

//     effect(() => {
//         console.log('length', object.value.length)
//     })

//     setTimeout(() => {
//         console.log("push");
//         object.value.push({ name: "nora" });
//         setTimeout(() => {
//             console.log("delete");
//             object.deleteState();
//         }, 1000)
//     }, 1000)
// }

// test_deepProxy();

function demo() {

    console.log("1")
    setTimeout(() => {
        console.log("2")
        setTimeout(() => {
            console.log("3")
        });
    });
    setTimeout(() => {
        console.log("4")
    });
    console.log("5");

    // const items = new State([]);

    // effect(() => {

    //     document.body.innerHTML = "";

    //     for (const item of items.value) {

    //         const h1 = document.createElement("h1");
    //         h1.textContent = `${item}`;

    //         document.body.append(h1);
    //     }
    // });

    // items.value.push("nikko")
    // items.value.push("yssa")
}

demo();
