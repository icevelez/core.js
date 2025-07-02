# 📘 Handlebar

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
