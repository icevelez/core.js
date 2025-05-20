# 📘Handlebar Syntax Documentation

The handlebar template engine supports dynamic rendering using a Handlebars-inspired syntax. It outputs **actual DOM elements**, not just HTML strings, and allows for reactive or static use thanks to the Signal based reactivity system

---

---

## 1. Expression Interpolation

### Usage
```html
<h1>{{ someExpression }}</h1>
```

### Expressions
```html
<h1>Hello {{ "world" + "!" }}</h1>
```

### Attribute Support

Expressions can be embedded inside HTML attributes.
```html
<h1 class="text-lg {{ isBig ? 'font-bold' : 'font-light' }}">Hello</h1>
```
> Note: JavaScript expressions inside {{ ... }} are fully supported.

---

## 2. Conditional Blocks

### Basic `if`
```html
{{#if isLoggedIn}}
  <p>Welcome back!</p>
{{/if}}
```

### `if` with `else`
```html
{{#if isAdmin}}
  <p>Admin Panel</p>
{{else}}
  <p>Access Denied</p>
{{/if}}
```

### `if`, `else if` with `else`
```html
{{#if user.isAdmin}}
  <p>Admin Panel</p>
{{else if user.isModerator}}
  <p>Moderator Tools</p>
{{else}}
  <p>Access Denied</p>
{{/if}}
```

---

## 3. Loops

### `each` block
```html
<ul>
  {{#each items as item, i}}
    <li>{{ i }}. {{ item.name }}</li>
  {{/each}}
</ul>
```

### `each` with empty fallback
```html
<ul>
  {{#each users as user}}
    <li>{{ user.name }}</li>
  {{empty}}
    <li>No users found.</li>
  {{/each}}
</ul>
```

---

## 4. Awaiting Promises

### Basic await
```html
{{#await userPromise}}
  <p>Loading...</p>
{{then user}}
  <p>Hello {{ user.name }}</p>
{{/await}}
```

### With error handling
```html
{{#await dataPromise}}
  <p>Loading data...</p>
{{then data}}
  <pre>{{ data }}</pre>
{{catch error}}
  <p class="text-red-500">Error: {{ error.message }}</p>
{{/await}}
```

---

# Components

## 5.1 Creating Components

### Basic Usage

To create components you must use the `component` function from `/template-engine/handlebar.js` file

```js
import { load } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";

export default component({
    // Directly embedding template inside a component
    template: `
        <h1>Hello World!</h1>
    `
});
```

### Adding in context and logic to your component
```js
import { load } from "../core/core.js";
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

### Using the `load` function to load an html template
```js
import { load } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { State } from "../core/reactivity.js";

import CustomComponent from "./components/CustomComponent.js";

export default component({
    template: await load("src/App.html")
}, class {
    // all component logic lives here

});
```

## 5.2 Importing Components

```js
import { load } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { State } from "../core/reactivity.js";

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

## 5.3 Using Component

### Self-closing components
```html
<CustomComponent />
```

### Component with children
```html
<CustomComponent>
  <h1>This is a child element</h1>
</CustomComponent>
```

## 5.4 Custom Component Attributes

### Supports passing any expression as an attribute:
```html
<MyButton onClick="{{ () => submit(form) }}" text="{{ buttonText }}" />
```

---

## 6. Event Listeners

### Inline event handler
```html
<button onclick="{{ () => alert('clicked!') }}">Click</button>
```

### Using a context method
```html
<button onclick="{{ handleClick }}">Click</button>
```

---

## 7. `bind:` Directive (Two-Way Binding)

### Bind `value`
```html
<input type="text" bind:value="user.name" />
```

### Bind `type="checkbox"` or other inputs
```html
<input type="checkbox" bind:checked="user.is_admin" />
```

---

## 8. `use:` Directive (Action Support)

### Basic usage
```html
<input use:focus />
```

### With parameters
```html
<input use:tooltip="{{ 'Enter your name' }}" />
```

### Action Function Signature
Each action should be a function with the signature:
```js
function myAction(node, parameter) {
  // Setup logic

  return () => {
      // clean up logic for when the node is destroyed
  }
}
```

---

## 🛠️ Notes

- Templates are parsed into real DOM nodes (not strings).

- JavaScript expressions inside `{{ }}` are evaluated in the current context.

## Internal process of how the Handlebar engine works

1. The template engine parses your html file by collecting all expression block like `{{#if}}` or `{{#each}}` and replacing it with a div element with a marker id (`<div id="marker">`) and converts it to a DOM element
2. Which is then processed by replacing the marked div elements with **anchor tags** (represented as a comment element or text node to make it invisible in the elements tab) and render the dynamic content in between the anchor elements using the saved expression block

    The anchor tags are used to keep track of the placement of each dynamic content

3. All processed DOM elements are ran inside the reactive primitive `effect()` to keep track of updates and re-renders
4. Then put all rendered DOM element inside a `DocumentFragment`
5. Which is then appended to a target element using the `mount()` function from `core.js`
