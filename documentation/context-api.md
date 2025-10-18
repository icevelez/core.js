# 📘 Context API

The **Context API** enables components to share values with their descendants **without explicitly passing props**. This is especially useful for passing configuration, services, or reactive state deeply through the component tree.


## 🔧 `setContext`

Establishes a key–value pair on the current component or execution scope. Descendant components can access this value using `getContext`.

### Usage

```js
import { setContext } from "core/core.js";

// In a parent component
setContext('theme', 'dark');
```

---

## 📥 `getContext`

Retrieves a value associated with a previously established context `key`. Searches through the component hierarchy.

### Usage

```js
import { getContext } from "core/core.js";

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
* Shared scope reactive stores or services

---

## Limitations

* Context is not inherently reactive unless combined with a reactive system.
* Only works within component trees.

---
