class TSFRepository {
    static classes = new Map();

    static registerComponent(c) {
        TSFRepository.classes.set(c.name, c);
    }

    static getClass(name) {
        return TSFRepository.classes.get(name);
    }

    static afterLoad() {

    }

    static getRelevantChildren(elem) {
        const result = [];

        for (const child of elem.children) {
            result.push(child);

            if (!child.nodeName.startsWith('TSF-') && Array.from(child.attributes).filter(({ name, value }) => name === 'tsf-for-of').length === 0) {
                result.push(...TSFRepository.getRelevantChildren(child));
            }
        }

        return result;
    }

    static getCustomElements(elem) {
        const result = [];

        for (const child of elem.children) {
            if (child.nodeName.startsWith('TSF-'))
                result.push(child);

            result.push(...TSFRepository.getCustomElements(child));
        }

        return result;
    }
}

class TSFProxy {
    static comparisons = {}
    
    constructor() {
        this._jsChange = {};// handle the change of the JS element
        this._domChange = {}; // handle the change of the DOM element
    }

    registerJsChangeListener(name, callback) {
        const currentListener = this._jsChange[name] || (() => { });
        this._jsChange[name] = function (...args) {
            currentListener(...args);
            callback(...args);
        };
    }

    registerDomChangeListener(name, callback) {
        const currentListener = this._domChange[name] || (() => { });
        this._domChange[name] = function (...args) {
            currentListener(...args);
            callback(...args);
        };
    }

    overwriteJsChangeListener(name, callback) {
        this._jsChange[name] = callback;
    }

    overwriteDomChangeListener(name, callback) {
        this._domChange[name] = callback;
    }

    static compare(a, b) {
        if(a === undefined && b === undefined)
            return true;
        
        if(a === null && b === null)
            return true;
        try {
            const constructorNameA = a.constructor.name;
            const constructorNameB = b.constructor.name;

            if(constructorNameA !== constructorNameB)
                return false;

            if(TSFProxy.comparisons[constructorNameA])
                return TSFProxy.comparisons[constructorNameA](a, b);
            
            return JSON.stringify(a) === JSON.stringify(b);
        } catch(e) {
            return false;
        }
    }

    static registerComparison(name, func) {
        TSFProxy.comparisons[name] = func;
    }

    static generateProxies(target, key, value) {
        if (!value || ["Object", "Array"].indexOf(value.constructor.name) < 0) {
            return value;
        }

        for(let k of Object.keys(value)) {
            value[k] = TSFProxy.generateProxies(target, key, value[k]);
        }
        
        value = new Proxy(value, TSFProxy.handler(target, key));

        return value;
    }

    static handler(context, name) {
        return {
            get: function (target, name) {
                return name in target ? target[name] : "";
            },
            set: function (target, key, value) {
                value = TSFProxy.generateProxies(target, key, value);
                if(TSFProxy.compare(target[key], value)) // Nothing changed
                    return true;

                target[key] = value;
                if (context) {
                    if (name in context['_domChange'])
                        context['_domChange'][name](context[name]);
                } else {
                    if (key in target['_domChange'])
                        target['_domChange'][key](value);
                }

                return true;
            },
            deleteProperty: function (target, property) {
                if (context) {
                    if (name in context['_domChange'])
                        context['_domChange'][name](target);
                } else {
                    if (property in target['_domChange'])
                        target['_domChange'][property](null);
                }
                return true;
            }
        }
    };
}

class TSFComponent extends HTMLElement {
    constructor() {
        super();
        this.state = new Proxy(new TSFProxy, TSFProxy.handler());

        const parentProperties = Object.keys(this.parentNode);
        const children = this.querySelectorAll('*');
        for (const prop of parentProperties) {
            const parentValue = this.parentNode[prop];
            this[prop] = this[prop] || parentValue;
            for (const child of children) {
                children[prop] = child[prop] || parentValue;
            }
        }

        if (window.getComputedStyle(this) !== 'none')
            this.onShow();

        this.attachBindings(this);
    }

    onShow() {

    }

    eval(attributeValue, obj, returnVariables) {
        let toBeEvaluated = attributeValue;
        let args = [];
        const controllerVariables = [];
        const objectVariables = [];

        const controllerVariablesRegex = /this\.(.[a-zA-Z|_]+)/g;
        const objectVariablesRegex = /local\.(.[a-zA-Z|_|\:]+)/g;

        let match;
        while ((match = controllerVariablesRegex.exec(attributeValue)) !== null) {
            controllerVariables.push(match[1]);
        }

        while ((match = objectVariablesRegex.exec(attributeValue)) !== null) {
            objectVariables.push(match[1]);
        }
        for (const variable of controllerVariables) {
            args.push(this.state[variable]);

            toBeEvaluated = toBeEvaluated.replace('this.' + variable, `args[${args.length - 1}]`);
        }

        for (let variable of objectVariables) {
            const indexOnly = variable.endsWith(':index');
            if (indexOnly)
                variable = variable.replace(':index', '');

            if (obj[variable] && obj[variable].length === 2) {
                const index = obj[variable][0];
                const array = obj[variable][1];
                if (indexOnly)
                    toBeEvaluated = toBeEvaluated.replace('local.' + variable + ':index', index);
                else {
                    args.push(array[index]);
                    toBeEvaluated = toBeEvaluated.replace('local.' + variable, `args[${args.length - 1}]`);
                }
            } else {
                toBeEvaluated = toBeEvaluated.replace('local.' + variable, "");
            }
        }

        let result;
        try {
            result = window.eval.call(window, '(function (args) {return ' + toBeEvaluated + '})')(args);
        } catch (e) {
            result = "";
        }

        if(returnVariables) 
            return [result, controllerVariables, objectVariables];
        else
            return result;
    }

    attachBindings(elem) {
        const objects = TSFRepository.getRelevantChildren(elem);

        // Set up ifs
        for (const obj of objects.filter(e => Array.from(e.attributes).filter(({ name, value }) => name.startsWith('tsf-if')).length)) {
            const attributeValue = obj.getAttribute('tsf-if');; // Value to be evaluated
            const display = obj.getAttribute('tsf-if-display') || "block";

            let result, controllerVariables, objectVariables;
            [result, controllerVariables, objectVariables] = this.eval(attributeValue, obj, true);

            // Set initial value
            if (result) {
                obj.style.display = display;
                if(obj.onShow)
                    obj.onShow();
                for (const customElement of TSFRepository.getCustomElements(obj)) {
                    customElement.onShow();
                }
            } else {
                obj.style.display = "none";
            }
            // Listen for changes in the JS variable and transfer them to the DOM
            for (const variableName of controllerVariables) {
                const f = () => {
                    if (this.eval(attributeValue, obj)) {
                        obj.style.display = display;
                        if(obj.onShow)
                            obj.onShow();
                        for (const customElement of TSFRepository.getCustomElements(obj)) {
                            if (customElement.onShow)
                                customElement.onShow();
                        }
                    } else {
                        obj.style.display = "none";
                    }
                };
                this.state.registerDomChangeListener(variableName, f);
            }
        }

        // Set up value binding
        for (const obj of objects.filter(e => Array.from(e.attributes).filter(({ name, value }) => name === 'tsf-value').length)) {
            const variableName = obj.getAttribute('tsf-value').replace("this.", "");

            // Listen for changes in the JS variable and transfer them to the DOM
            this.state.registerDomChangeListener(variableName, value => {
                obj.value = value;
            });

            this.state.registerJsChangeListener(variableName, val => {
                this.state[variableName] = val;
            });

            // Listen for changes in the DOM and transfer them to js
            obj.oninput = event => {
                let val = obj.value;

                if(val !== "" && !isNaN(val))
                    val = Number(val);

                const newValue = val;
                obj.value = this.state[variableName]; // Keep old value until js value changes
                this.state._jsChange[variableName](newValue);
            }
        }

        // Set up innerHTML binding
        for (const obj of objects.filter(e => Array.from(e.attributes).filter(({ name, value }) => name === 'tsf-html').length)) {
            const attributeValue = obj.getAttribute('tsf-html'); // Value to be evaluated
            let renderFunction = obj.getAttribute('tsf-html-render');

            let that = window;
            if (renderFunction && renderFunction.startsWith('this.')) {
                that = this;
                renderFunction = renderFunction.substr(5);
            }

            let result, controllerVariables, objectVariables;
            [result, controllerVariables, objectVariables] = this.eval(attributeValue, obj, true);

            // Set initial value
            obj.innerHTML = renderFunction ? that[renderFunction].call(that, this.eval(attributeValue, obj)) : result;
            // Listen for changes in the JS variable and transfer them to the DOM
            for (const variableName of controllerVariables) {
                const f = () => {
                    obj.innerHTML = renderFunction ? that[renderFunction].call(that, this.eval(attributeValue, obj)) : this.eval(attributeValue, obj);
                };
                this.state.registerDomChangeListener(variableName, f);
            }
        }

        // Set up attribute bindings
        for (const obj of objects.filter(e => Array.from(e.attributes).filter(({ name, value }) => name.startsWith('tsf-bind-attribute-')).length)) {
            const attributes = Array.from(obj.attributes).filter(({ name, value }) => name.startsWith('tsf-bind-attribute-'));

            for (const attribute of attributes) {
                const attributeName = attribute.name.substr(19);
                const attributeValue = attribute.value; // Value to be evaluated
                
                let result, controllerVariables, objectVariables;
                [result, controllerVariables, objectVariables] = this.eval(attributeValue, obj, true);

                // Set initial value
                obj.setAttribute(attributeName, result);
                // Listen for changes in the JS variable and transfer them to the DOM
                for (const variableName of controllerVariables) {
                    const f = () => {
                        obj.setAttribute(attributeName, this.eval(attributeValue, obj));
                    };
                    this.state.registerDomChangeListener(variableName, f);
                }
            }
        }

        // Set up boolean attribute bindings
        for (const obj of objects.filter(e => Array.from(e.attributes).filter(({ name, value }) => name.startsWith('tsf-bind-boolean-attribute-')).length)) {
            const attributes = Array.from(obj.attributes).filter(({ name, value }) => name.startsWith('tsf-bind-boolean-attribute-'));

            for (const attribute of attributes) {
                const attributeName = attribute.name.substr(27);
                const attributeValue = attribute.value; // Value to be evaluated

                let result, controllerVariables, objectVariables;
                [result, controllerVariables, objectVariables] = this.eval(attributeValue, obj, true);

                // Set initial value
                if (result) {
                    obj.setAttribute(attributeName, null);
                } else {
                    obj.removeAttribute(attributeName);
                }
                // Listen for changes in the JS variable and transfer them to the DOM
                for (const variableName of controllerVariables) {
                    const f = () => {
                        if (this.eval(attributeValue, obj)) {
                            obj.setAttribute(attributeName, null);
                        } else {
                            obj.removeAttribute(attributeName);
                        }
                    };
                    this.state.registerDomChangeListener(variableName, f);
                }
            }
        }

        // Set up class bindings
        for (const obj of objects.filter(e => Array.from(e.attributes).filter(({ name, value }) => name.startsWith('tsf-bind-class-')).length)) {
            const attributes = Array.from(obj.attributes).filter(({ name, value }) => name.startsWith('tsf-bind-class-'));

            for (const attribute of attributes) {
                const attributeName = attribute.name.substr(15);
                const attributeValue = attribute.value; // Value to be evaluated
                
                let result, controllerVariables, objectVariables;
                [result, controllerVariables, objectVariables] = this.eval(attributeValue, obj, true);

                // Set initial value
                if (result) {
                    obj.classList.add(attributeName);
                } else {
                    obj.classList.remove(attributeName);
                }
                // Listen for changes in the JS variable and transfer them to the DOM
                for (const variableName of controllerVariables) {
                    const f = () => {
                        if (this.eval(attributeValue, obj)) {
                            obj.classList.add(attributeName);
                        } else {
                            obj.classList.remove(attributeName);
                        }
                    };
                    this.state.registerDomChangeListener(variableName, f);
                }
            }
        }

        // Set up function bindings
        for (const obj of objects.filter(e => Array.from(e.attributes).filter(({ name, value }) => name.startsWith('tsf-bind-function-')).length)) {
            const attributes = Array.from(obj.attributes).filter(({ name, value }) => name.startsWith('tsf-bind-function-'));

            for (const attribute of attributes) {
                const eventName = attribute.name.substr(18);
                let functionName = attribute.value;
                let variableName = /\((.+?)\)/.exec(functionName);
                let result, controllerVariables, objectVariables;

                if (variableName) {
                    [result, controllerVariables, objectVariables] = this.eval(variableName[1], obj, true);
                    functionName = functionName.replace(variableName[0], "");
                }

                let that = window;
                if (functionName.startsWith('this.')) {
                    that = this;
                    functionName = functionName.substr(5);
                }

                obj.addEventListener(eventName, e => {
                    if (variableName) {
                        that[functionName].call(that, e, this.eval(variableName[1], obj));
                    } else {
                        that[functionName].call(that, e);
                    }

                });
            }
        }

        // Set up for loops
        for (const obj of objects.filter(e => Array.from(e.attributes).filter(({ name, value }) => name === 'tsf-for-of').length)) {
            const attributeContent = obj.getAttribute('tsf-for-of');
            const loopName = attributeContent.split('of')[0].trim();
            const variableName = attributeContent.split('of')[1].trim();
            let result, controllerVariables, objectVariables;
            [result, controllerVariables, objectVariables] = this.eval(variableName, obj, true);
            
            let template = document.createElement('template');
            template.innerHTML = obj.innerHTML;
            while (obj.firstChild) {
                obj.removeChild(obj.firstChild);
            }

            if (result && result.length > 0) {
                for (let index = 0; index < result.length; index++) {
                    const node = template.content.cloneNode(true);
                    obj.appendChild(node);

                    for (const child of obj.querySelectorAll('*')) {
                        child[loopName] = child[loopName] || [index, result];
                    }
                }
                this.attachBindings(obj);
            }

            for (const vn of controllerVariables) {
                // Listen for changes in the JS variable and transfer them to the DOM
                this.state.registerDomChangeListener(vn, () => {
                    const value = this.eval(variableName, obj);
                    while (obj.firstChild) {
                        obj.removeChild(obj.firstChild);
                    }

                    for (let index = 0; index < value.length; index++) {
                        const node = template.content.cloneNode(true);
                        obj.appendChild(node);

                        for (const child of obj.querySelectorAll('*')) {
                            child[loopName] = child[loopName] || [index, value];
                        }
                    }
                    this.attachBindings(obj);
                });
            }
        }
    }

    mapProperties(obj, template) {
        const result = [];

        for (let prop of Object.keys(obj)) {
            template[prop] = obj[prop];
        }

        if (template.nodeName.startsWith('TSF-'))
            result.push(template);

        for (let i = 0; i < obj.children.length; i++) {
            result.push(...this.mapProperties(obj.children[i], template.children[i]));
        }

        return result;
    }
}

const parseDom = event => {
    const customElements = TSFRepository.getCustomElements(document);

    for (let i = 0; i < customElements.length; i++) {
        const node = customElements[i];
        const name = node.nodeName.toLowerCase();

        if (!document.createElement(name).constructor !== HTMLElement) {
            let className = "";
            for (const partialName of name.substr(3).split('-')) {
                className = className + partialName.charAt(0).toUpperCase() + partialName.slice(1);
            }

            window.customElements.define(name, TSFRepository.getClass(className));
        }
    }
}

if (window.attachEvent) {
    window.attachEvent('onload', parseDom);
} else {
    if (window.onload) {
        const currentOnLoad = window.onload;
        const newOnLoad = function (evt) {
            currentOnLoad(evt);
            parseDom(evt);
        };
        window.onload = newOnLoad;
    } else {
        window.onload = parseDom;
    }
}