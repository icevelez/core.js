# 📘 Component Life Cycle

The natural sequence of events that a UI component goes through from the moment it's created until the moment it's removed from the page.

## 🔼 onMount

Invoked once when the component is inserted into the DOM. Use it to run setup logic like subscriptions, measurements, or animations.
Function signature

```js
function onMount(callback: () => void | (() => void)): void
```

> The callback can optionally return a cleanup function. The returned cleanup will be called automatically when the component unmounts (see onUnmount).

### Example
```js
onMount(() => {
  console.log("Component mounted!");

  const interval = setInterval(() => console.log("Tick"), 1000);

  return () => {
    clearInterval(interval);
    console.log("Cleanup on unmount");
  };
});
```

## 🔽 onUnmount

Registers a cleanup function to be called when the component or block is removed from the DOM.

Function signature
```js
function onUnmount(callback: () => void): void
```

> Called once during teardown. Useful for manually registered cleanups that cannot be returned from onMount.

### Example
```js
onUnmount(() => {
  console.log("Component was removed");
});
```

## ✅ Best Practices

- Always clean up side effects in `onUnmount` or via the return function of `onMount`.
- Avoid DOM reads or writes in component constructors — defer those to `onMount` for correct timing.

---
