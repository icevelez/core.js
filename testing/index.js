
import { createAsyncDerived, createDerived, createSignal, effect } from "./core/reactivity.js";

const count = createSignal(0);

const randomDerived = createDerived(() => {
    return new Promise((resolve, reject) => {
        const c = count();
        const timeout_in_ms = Math.ceil((Math.random() * 9) + 1) * 1000;
        setTimeout(() => {
            if (timeout_in_ms > 5000) return resolve(`resolved count ${c}. timeout ${timeout_in_ms}`)
            reject(`reject count ${c}. timeout ${timeout_in_ms}`);
        }, timeout_in_ms)
    })
})

const properDervied = createAsyncDerived(() => randomDerived())

effect(() => {
    console.log("properDervied", properDervied());
})

const maxCount = 10;
const timeout = setInterval(() => {
    if (count() >= maxCount) return clearInterval(timeout);
    count.set(count() + 1);
    console.log("set interval count");
}, 1000);
