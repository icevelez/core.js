# 📘Handlebar Syntax Documentation

The handlebar template engine supports dynamic rendering using a Handlebars-inspired syntax. It outputs **actual DOM elements**, not just HTML strings, and allows for reactive or static use thanks to the Signal based reactivity system

---

## 1. Expression Interpolation

### ✅ Basic Usage
```html
<h1>{{ "Hello World" }}</h1>
```

### ✅ Attribute Support

Expressions can be embedded inside HTML attributes.
```html
<h1 class="text-lg {{ isBig ? 'font-bold' : 'font-light' }}">Hello</h1>
```
> Note: JavaScript expressions inside {{ ... }} are fully supported.

---

## 2. Conditional Blocks

### ✅ Basic `if`
```html
{{#if isLoggedIn}}
  <p>Welcome back!</p>
{{/if}}
```

### ✅ `if` with `else`
```html
{{#if isAdmin}}
  <p>Admin Panel</p>
{{:else}}
  <p>Access Denied</p>
{{/if}}
```

### ✅ `if`, `else if` with `else`
```html
{{#if user.isAdmin}}
  <p>Admin Panel</p>
{{:else if user.isModerator}}
  <p>Moderator Tools</p>
{{:else}}
  <p>Access Denied</p>
{{/if}}
```

---

## 3. Loops

> Accessing individual values from an array requires using the getter as a function `()` property and setting a new value requires using `.set()` or `.update()`. This API decision is due to the limitation of JavaScript with closures where re-assigning a value `item = new_item` will not trigger reactivity.

### ✅ `each` block
```html
<ul>
  {{#each items() as item, i}}
    <li>{{ i }}. {{ item().name }}</li>
  {{/each}}
</ul>
```

### ✅ `each` with empty fallback
```html
<ul>
  {{#each users() as user}}
    <li>{{ user().name }}</li>
  {{:empty}}
    <li>No users found.</li>
  {{/each}}
</ul>
```

### ✅ With index
```html
{{#each items as product, i}}
  <div>{{ i }}. {{ product().name }}</div>
{{/each}}
```
> The second alias (`i`) is optional. You can name it anything:

---

## 4. Awaiting Promises

### ✅ Basic await
```html
{{#await userPromise}}
  <p>Loading...</p>
{{:then user}}
  <p>Hello {{ user.name }}</p>
{{/await}}
```

### ✅ Await with error handling
```html
{{#await dataPromise}}
  <p>Loading data...</p>
{{:then data}}
  <pre>{{ data }}</pre>
{{:catch error}}
  <p class="text-red-500">Error: {{ error.message }}</p>
{{/await}}
```

### ✅ Advance Await. Async Components
```html
{{#await import("./components/List.js")}}
  <p>Loading list..</p>
{{:then listComponent}}
  <Core:component default="listComponent"/>
{{:catch error}}
  <p class="text-red-500">Error loading list component</p>
{{/await}}
```

The `<Core:component/>` directive allows a **custom component** to be displayed

> in v0.1.1 and below. the component syntax was `<Component default="{{ componentName }}">`

```html
<Core:component default="component">
```

---

# 5. Components

## 5.1 Creating Components

### ✅ Basic Usage

To create components you must use the `component` function from `/template-engine/handlebar.js` file

```js
import { component } from "../core/template-engine/handlebar.js";

export default component({
    // Directly embedding template inside a component
    template: `
        <h1>Hello World!</h1>
    `
});
```

### ✅  Adding in context and logic to your component
```js
import { component } from "../core/template-engine/handlebar.js";

export default component({
    template: `
        <h1>Hello {{ name }}</h1>
    `
}, class {
    // all component logic lives here
    name = "Viewer"

    constructor() {}
});
```

### ✅  Using the `load` function to load an html template
```js
import { load } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";

export default component({
    template: await load("src/App.html")
}, class {
    // all component logic lives here

});
```

## 5.2 Importing Components

### ✅ Usage
```js
import { load } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";

import CustomComponent from "./components/CustomComponent.js";
import AnotherComponent from "./components/AnotherComponent.js";

export default component({
    template: await load("src/App.html"),
    component : {
        CustomComponent,
        AnotherComponent
    }
}, ...);
```

## 5.3 Using imported Component

### ✅ Self-closing components
```html
<CustomComponent />
```

### ✅ Component with children
```html
<AnotherComponent>
  <h1>This is a child element</h1>
</AnotherComponent>
```

## 5.4 Custom Component Attributes

### ✅ Supports passing any expression as an attribute:
```html
<MyButton onClick="{{ () => submit(form) }}" text="{{ buttonText }}" />
```

## 5.5 Component Content Insertion

The `<Core:slot />` directive allows a **custom component** to display child content passed into it.

> in v0.1.1 and below. the directive was called `<Slot>`

---

### ✅ Basic Usage

**Component Definition:**

```html
<!-- MyComponent.html -->
<div class="card">
  <Core:slot/>
</div>
```
```html
<MyComponent>
  <h1>Hello from outside</h1>
</MyComponent>
```

---

## 6. Event Listeners

### ✅ Inline event handler
```html
<button onclick="{{ () => alert('clicked!') }}">Click</button>
```

### ✅ Using a context method
```html
<button onclick="{{ handleClick }}">Click</button>
```

---

## 7. `bind:` Directive (Two-Way Binding)

### ✅ Bind `value`
```html
<input type="text" bind:value="user.name" />
```

### ✅ Bind `type="checkbox"` or other inputs
```html
<input type="checkbox" bind:checked="user.is_admin" />
```

---

## 8. `use:` Directive (Action Support)

### Caveat!

> due to HTML specification, HTML attributes are case insensitive so function names used in this directive cannot be pascal Case

### ✅ Correct usage
```html
<input use:myaction />
```

### 🚫 Incorrect usage
```html
<input use:myAction />
```

### ✅ With parameters
```html
<input use:myaction="{{ 'Enter your name' }}" />
```

### ✅ Action Function Signature
Each action should be a function with the signature:
```js
function myaction(node, parameter) {
  // Setup logic

  return () => {
      // clean up logic for when the node is destroyed
  }
}
```

# Component Life Cycle

## 🔼 onMount

Invoked once when the component or DOM fragment is inserted into the DOM. Use it to run setup logic like subscriptions, measurements, or animations.
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

# 📘 Context API Documentation

The **Context API** enables components to share values with their descendants **without explicitly passing props**. This is especially useful for passing configuration, services, or reactive state deeply through the component tree.


## 🔧 `setContext`

Establishes a key–value pair on the current component or execution scope. Descendant components can access this value using `getContext`.

### Usage

```js
// In a parent component
setContext('theme', 'dark');
```

---

## 📥 `getContext`

Retrieves a value associated with a previously established context `key`. Searches through the component hierarchy.

### Usage

```js
// In a child component
const theme = getContext('theme');
console.log(theme); // "dark"
```

---

## Behavior

* Context values are **scoped to the component tree**.
* A `getContext()` call will traverse up the tree until it finds a matching `setContext()`.
* Repeated `setContext()` on the same key will override earlier values **only in that subtree**.

---

## Example

```js
// RootComponent.js
setContext('user', { name: 'Alice' });

// ChildComponent.js
const user = getContext('user');
```

---

## Use Cases

* Dependency injection
* Theme management
* Localization (i18n)
* Shared reactive stores or services
* Logging or feature flags

---

## Limitations

* Context is not inherently reactive unless combined with a reactive system.
* Only works within component trees (not across portals or detached nodes).
* `setContext()` and `getContext()` only works inside a component

---
