# Core.js

A Framework built for the web

---

Version: 0.2.6

License: MIT

---

## 👷 How does it work?

There's two components that make up `Core.js`. It's **reactivity system** and **template engine**

The reactivity system handles tracking signal update, deletion, and creation of data while the template engine is in charge of parsing template string to the DOM. Combined the two and you get this framework

> One neat tidbit you might have not notice is that you can build your own template engine that parses whatever syntax you want, as long as the reactivity system is integrated by using `effect()` among other primitives.
>
> You can have a template engine that parses `{{ handlebar }}` and another for `@{ razor }`

The reactivity system is my implementation of *Signals* based from my understanding from [Svelte](https://svelte.dev/) and [Solid.js](https://www.solidjs.com/)

---

## 🧰 Installation

> You can skip all of the step by downloading this repository and start creating your app under the `src` folder
>

1. Create a folder for your project

2. Download this repository

3. Extract its content and copy a folder named `core` to your project folder

4. Create a folder named `src` in your project folder. This is where all your app code will go

5. Inside the `src` folder create a file named `App.html` and `App.js` with the following content respectively
```html
<h1>{{ message }}</h1>
```

```js
import { load } from "../core/core.js";
import { component } from "../core/handlebar.js";

export default component({
    template: await load("src/App.html"),
}, class {

    message = "Hello World";

    constructor() {}

});
```

6. In the root of your project folder create a file named `index.html` and `index.js` with the following content respectively

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

> You can use the `Live Server` extension in VSCode to run and start developing you app

---

## 📖 Documentation

You can read the full documentation of how to use this framework by opening an `.md` file under `documentation` folder of this repository

---

## 🫶 Special Thanks

- zulu - from the Solid Discord group for helping me debug a reactivity problem regarding proxies
- Patrick - from the Svelte Discord group for helping me better understand fine-grain reactivity

---

## Limitation

- Missing IntelliSense support in VSCode, Zed, etc...

## 📝 P.S

I'm not God, I make mistakes, I have tested this to the best of my ability but if you find any bugs or issues, kindly email me about it and if you have a fix/patch, feel free to include that in your email.

---

## 📇 Contact

```
Email Address: icevelezdev@gmail.com
```

Hey! you made it this far. Thank you for reading everything!
