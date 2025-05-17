# Core.js

A framework without a bundler

---

Version: 0.1.0

License: MIT

---

## What is Core.js?

Core.js is my attempt at building a framework that can work without relying on a bundler like Vite, Rollup, or Webpack.

## Why?

When I try to start a project I always reach out to Vite to build my project and once finish I have to build the app and copy the compiled front-end code over to the back-end. I'd like to change that by just immediately writing the front-end app, no more build step while still getting the benefit of reactivity and expressiveness of templating

## How does it work?

There's two components that make up `Core.js`. It's reactivity system and templating engine

The reactivity system is based on "Signals" while its templating engine is based on a mixture of "Handlebar.js" and "Svelte" syntax

1. The template engine parses your html file by collecting all expression and replacing it with a marker id `<div id="marker">`  then converts it to a DOM element
2. Which is then processed by replacing the marked div elements with **anchor elements** (represented as a comment element or text node to make it invisible in the elements tab) and render the dynamic content using the saved expression in between the anchor elements.

    The anchor elements are used to keep track of the placement of each dynamic content

3. All processed DOM elements are ran inside a reactive primitive `effect()` to keep track of updates and re-render
4. Then put all rendered DOM element inside a `DocumentFragment`
5. Which is then appended to a target element using the `mount()` function

> One neat feature about the Core.js architecture is that you can build your own template engine that parses whatever syntax you want, as long as you use `effect()` to integrate the reactivity system

## Installation

1. Create a folder for your project

2. Download `core.js.v0.1.0.zip` or this repository

3. Extract its content and copy a folder named `core` to your project folder

4. Create a folder named `src` in your project folder. This is where all your app code will go

5. Inside the `src` folder create a file named `App.js` and `App.html` with the following content
```html
<h1>{{ message }}</h1>
```

```js
import { load, onMount } from "../core/core.js";
import { component } from "../core/template-engine/handlebar.js";
import { State } from "../core/reactivity.js";

export default component({
    template: await load("src/App.html"),
}, class {

    message = "Hello World";

    constructor() {}

});
```

6. In the root of your project folder create a file named `index.html` and `index.js` with the following content.

```html
<html>
    <head>
        <title>My App</title>
        <script type="module" src="index.js"></script>
    </head>
    <body>
        <div id="app"></div>
    </body>
</html>
```
```js
import { mount } from './core/core.js';
import App from './src/App.js';

mount(App, { target: document.getElementById('app') })
```
We are importing `App.js` from the `src` folder to render it to our target element which is `<div id="app">`

7. Congratulations! You're now ready to build your application using Core.js

---

## Quick Tutorial

In this section I'll run you through how its syntax work

### Expressions

```html
<h1>Hello {{ "world" + "!" }}</h1>
```

### Special Syntax

`bind:[attribute]`

`use:[method]="{{ prop }}"`

### Conditionals

`{{#if}} ... {{else if}} ... {{/if}}`

`{{#each}} ... {{empty}} ... {{/each}}`

`{{#await}} ... {{then}} ... {{catch}} ... {{/await}}`

### Components

`<MyCustomComponent/>`

---

## F.A.Q

### Q: Why use an Angular class-like approach for component logic?

A: It's easier to instantiated a class and use its properties than to call a function and return an object with values the template needs

## Known Bugs

- Infinite recursion via components i.e ComponetA uses ComponentB and ComponentB uses ComponentA

## Limitation

*"Nothing is free, everything is a trade-off"* - Hussein Nasser

- Lack of code minification leading to bigger bundle sizes
- Lack of code optimization i.e: removing unused code and comment when compiling; compiling for an older ES version;
- Less performant than traditional frameworks due to the runtime process of parsing templates and attaching reactivity
- Intellisense in IDEs

## Should you use this?

That's for you to decide. I made this for myself of course I'm gonna use it

## Can I expect support?

Yeah! Its not feature complete there are things I still need to implement (checkout `todo.txt`) but feel free to email me for any concerns, suggestions, or ideas for this project

```
Email Address: icevelezdev@gmail.com
```

Hey! you made it this far in the documentation. Thank you for reading everything!
