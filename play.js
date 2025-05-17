
import { State, effect } from "./framework/reactivity.js";

const object = new State([
    {
        name: "ice",
        birthdate: new Date(),
        count: 100,
    },
    {
        name: "dominic",
        birthdate: null,
        count: 0
    }
]);

// async function fakeFetch(url) {
//     return new Promise((resolve) => {
//         const time = parseInt(1000 + (Math.random() * 5000));
//         setTimeout(() => resolve({ url, time }), time)
//     })
// }
// const count = new State(0);
// const data = new Derived(() => fakeFetch(`/api/v1/test?id=${count.value}`))

// const counter = new State(0);

// effect(() => {
//     console.log("counter", counter.value.fake_long)
// })

// setTimeout(() => {
//     counter.value = { fake: 'yes', fake_long: { lololol: false } };
// }, 1000);

effect(() => {
    console.log("object", object.value)
})

effect(() => {
    console.log("object zero", object.value[0])
})

effect(() => {
    console.log("object name", object.value[0].name)
})

effect(() => {
    console.log("object zero count", object.value[0].count)
})

let counter2 = 0;

const u = effect(() => {
    console.log("not exists", object.value[1].not_exist)

    effect(() => {
        console.log("count", object.value[1].count, "counter", counter2++)

        effect(() => {
            console.log("object", object.value, "counter", counter2++)

            return () => {
                console.log('cleaning up object')
            }
        })
    })
})

console.log("================")

setTimeout(() => {
    object.value[1].count = object.value[1].count + 1;

    object.value[1] = { name: 'not dom', birthdate: true, count: 32 };

    setTimeout(() => {
        object.value[1].not_exist = 'yes I do exists 0';
        console.log("================")
    }, 1000);

    setTimeout(() => {
        object.value[1].not_exist = 'yes I do exists 1';
        console.log("================")
    }, 2000);

    setTimeout(() => {
        object.value[1].not_exist = 'yes I do exists 2';
        console.log("================")
    }, 3000);

    setTimeout(() => {
        object.value[1].not_exist = 'yes I do exists 3';
        console.log("================")
    }, 4000);

    setTimeout(() => {
        object.value[1].not_exist = 'yes I do exists 4';
        console.log("================")
    }, 5000);

    setTimeout(() => {
        object.value[1].not_exist = 'yes I do exists 5';
        console.log("================")
    }, 6000);

    setTimeout(() => {
        console.log("================")
        console.log("un")
        u()

        setInterval(() => {
            console.log("X")
            object.value[1].count = object.value[1].count + 1;
        }, 1000);

        setTimeout(() => {
            console.log("Y")
            object.value[0] = "none";
        }, 2000);
    }, 7000);

    setTimeout(() => {
        console.log("update 2")
        object.value[1].not_exist = 'yes I do exists';
    }, 3000);

    setTimeout(() => {
        console.log("update 3")
        object.value[0] = "none";
    }, 3000);

    setTimeout(() => {
        console.log("update 4")
        object.value[0] = { name: "new ice", count: 69, birthdate: new Date() };
    }, 4000);
});
