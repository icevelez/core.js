# Core.js

A framework without a bundler

---

Version: 0.1.0

License: MIT

---

## What is Core.js?

Core.js is my attempt at building my own framework.

## Why?

> tl:dr -- satisfy an itch in my brain

*Story Time*-- When I started web dev, I made my own paradigm at making it "easy" for myself to write component-based HTML/JS unaware that it looked exactly like React code but instead of JSX it was calling a helper function to create HTML `$.create("div")` and it wasn't easy, it just made it a lot harder and crappier

I moved on to using JS Frameworks and fell in love with [Svelte](https://svelte.dev/), used it in every project, it has the expressiveness, the lightweight app bundle size, the friendly ecosystem, It is perfect! It felt like doing traditional web development

BUT! that itch of finishing what I started kept coming back which lead me to try again. (multiple attempts were made before landing here)

> [`Alpine.js`](https://alpinejs.dev/) exists, you can use that instead of this, this is my personal project, don't expect too much from it

## How does it work?

There's two components that make up `Core.js`. It's **reactivity system** and **template engine**

The reactivity system handles tracking state update, deletion, and creation while the template engine is in charge of parsing tempalte string to the DOM. Combined the two and you get this framework

> One neat tidbit you might have not notice is that you can build your own template engine that parses whatever syntax you want, as long as you use `effect()` and integrate the reactivity system.
>
> You can have a template engine that parses `{{ handlebar }}` and another for `@{ razor }`

---

### Internal process of how it works
1. The template engine parses your html file by collecting all expression block like `{{#if}}` or `{{#each}}` and replacing it with a div element with a marker id (`<div id="marker">`) and converts it to a DOM element
2. Which is then processed by replacing the marked div elements with **anchor tags** (represented as a comment element or text node to make it invisible in the elements tab) and render the dynamic content in between the anchor elements using the saved expression block

    The anchor tags are used to keep track of the placement of each dynamic content

3. All processed DOM elements are ran inside the reactive primitive `effect()` to keep track of updates and re-renders
4. Then put all rendered DOM element inside a `DocumentFragment`
5. Which is then appended to a target element using the `mount()` function

---

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

## Special Thanks

- zulu -- from the Solid Discord group for helping me debug a reactivity problem regarding proxies
- Patrick -- from the Svelte Discord group for helping me better understand fine-grain reactivity
- ChatGPT -- carrying me by giving the right `regex` to parse a specific syntax

---

## F.A.Q

### Q: Why use an Angular class-like approach for component logic?

A: It's easier to instantiated a class and use its properties than to call a function that returns an object with properties the template needs i.e Vue setup

---

## Known Bugs

- Infinite recursion via components i.e ComponetA uses ComponentB and ComponentB uses ComponentA

## Limitation

*"Nothing is free, everything is a trade-off"* - Hussein Nasser

- Lack of code minification leading to bigger bundle sizes
- Lack of code optimization i.e: removing unused code and comment when compiling; compiling for an older ES version;
- Less performant than traditional frameworks due to the runtime process of parsing templates and attaching reactivity
- Intellisense in IDEs

## P.S

I'm not God, I make mistakes, I have not benchmarked this code in any way so it may have poor performance or memory leak somewhere that I am not aware of.

I have tested this to the best of my ability but if you find any bugs or issues, kindly report it please, and if you have a fix/patch, feel free to create a pull request for me to look in to

---

## Contact

```
Email Address: icevelezdev@gmail.com
```

Hey! you made it this far in the documentation. Thank you for reading everything!
