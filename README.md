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

I moved on to using JS Frameworks and fell in love with [Svelte](https://svelte.dev/), used it in every project, it has the expressiveness, the lightweight app bundle size, the friendly ecosystem, It felt like traditional web development, Perfect!

BUT! that itch of finishing what I started kept coming back which lead me to try again. (multiple attempts were made before landing here)

> [`Alpine.js`](https://alpinejs.dev/) exists, you can use that instead of this, this is my personal project, don't expect too much from it

## How does it work?

There's two components that make up `Core.js`. It's **reactivity system** and **template engine**

The reactivity system handles tracking state update, deletion, and creation while the template engine is in charge of parsing template string to the DOM. Combined the two and you get this framework

> One neat tidbit you might have not notice is that you can build your own template engine that parses whatever syntax you want, as long as the reactivity system is integrated by using `effect()` among other primitives.
>
> You can have a template engine that parses `{{ handlebar }}` and another for `@{ razor }`

---

## Installation

> You can skip all of the step by downloading this repository and start creating your app under the `src` folder
>
> just delete the stuff you don't need like `documentation` and `testing` folder

1. Create a folder for your project

2. Download this repository

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

## Documentation

All documentation can be read under the `./documentation` folder

- [Handlebar](./handlebar.md)

---

## Special Thanks

- zulu -- from the Solid Discord group for helping me debug a reactivity problem regarding proxies
- Patrick -- from the Svelte Discord group for helping me better understand fine-grain reactivity

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

I have tested this to the best of my ability but if you find any bugs or issues, kindly email me about it and if you have a fix/patch, feel free to include that in your email.

---

## Contact

```
Email Address: icevelezdev@gmail.com
```

Hey! you made it this far in the documentation. Thank you for reading everything!
