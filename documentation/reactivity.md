# 📘Reacitivty Syntax Documentation

The reactvity syntax is based on the concept of `Signals` or auto-tracked observable subscriptions

---

## 1. Signal

It is a reactive container that holds a value of any type. When the value is accessed inside an `effect`, it automatically tracks the dependency. When the value is updated, all subscribed effects are scheduled to re-run.

### Constructor
```js
createSignal<T>(initialValue: T)
```
```
Properties
    () => T
    Getter tracks access in effect.

    set(new_value)
    Sets a new internal value then triggers subscribed effects.

    Update((current_value) => new_value)
    updates the internal value using a callback to either mutate the current value or replace it entirely which then triggers subscribed effects.
```
### Example
```js
const count = createSignal(0);

effect(() => {
  console.log("Count is:", count());
});

count.set(1); // Console logs: "Count is: 1"
```

---

## 2. Derived

It is a read-only reactive value computed from other Signal or Derived values. It automatically re-evaluates and updates its internal value when dependencies change.

### Constructor

```js
createDerived<T>(computeFn: () => T)
```
```
Properties
    () => T
    Automatically re-evaluated when dependencies change.
```
### Example
```js
const a = createSignal(1);
const b = createSignal(2);
const sum = createDerived(() => a() + b());

effect(() => {
  console.log("Sum is:", sum());
});

a.set(3); // Console logs: "Sum is: 5"
```

---

## 3. Effect

Registers a reactive effect—a function that will automatically re-run when any of the State values it accesses change.

### Function Signature
```js
effect(fn: () => void | (() => void)): () => void
```

> Automatically tracks State access. Returns a cleanup function to manually stop the effect.

### Example
```js
const message = new State("Hello");

const stop = effect(() => {
  console.log("Message is:", message.value);
});

message.value = "World"; // Console logs: "Message is: World"
stop();
```

## 4. Untracked Effect

Runs an effect in a "detached" mode, the reactive dependencies are not tracked by any parent `effect`. It is useful for isolated or short-lived effects (e.g., per-item rendering in `{{#each}}`).

## Function Signature
```js
untrackedEffect(fn: () => void): () => void
```
> Returns a cleanup function for internal subscriptions.

---

# 🧩 Internal Design

## Dependency Tracking

- Effects are tracked in a global `effectStack` array.
- When a `State` or proxied object property is accessed, the current effect is subscribed to it.
- When a value changes, the `State` or proxy calls `notifySubscribers` queuing all subscribers to re-run in a microtask.

## Deep Proxy

- Objects are wrapped via `createDeepProxy` to deeply intercept get and set operations.
- Each property has its own set of subscribers, stored in a WeakMap.

# 🔄 Reactivity Flow

- Reading a State or proxy property inside an effect registers the effect as a subscriber.
- Writing to that property notifies its subscribers.
- Notification is queued in a microtask to avoid redundant runs within the same tick.
- Cleanup functions remove old dependencies before re-tracking on the next run.
