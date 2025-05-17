import { component } from "../core/template-engine/handlebar.js";

export default component({
    template: `
        {{ component() }}
    `,
}, class {

    component;

    constructor(component) {
        if (!component || typeof component !== "object" || !component.default || typeof component.default !== "function")
            throw new TypeError("component is not a function");

        this.component = component.default;
    }

});
