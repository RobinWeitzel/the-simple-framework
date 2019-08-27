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

        for(const child of elem.children) {
            result.push(child);

            if(!child.nodeName.startsWith('TSF-') && Array.from(child.attributes).filter(({ name, value }) => name === 'tsf-for-of').length === 0) {
                result.push(...TSFRepository.getRelevantChildren(child));
            }
        }

        return result;
    }

    static getCustomElements(elem) {
        const result = [];

        for(const child of elem.children) {
            if(child.nodeName.startsWith('TSF-'))
                result.push(child);

            result.push(...TSFRepository.getCustomElements(child));
        }

        return result;
    }
}

class TSFProxy {
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

    static handler(context, name) {
        return {
            get: function (target, name) {
                return name in target ? target[name] : "";
            },
            set: function (target, key, value) {
                if (typeof value === 'object') {
                    value = new Proxy(value, TSFProxy.handler(target, key));
                }

                target[key] = value;
                if (context) {
                    if (name in context['_domChange'])
                        context['_domChange'][name](target);
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
        for(const prop of parentProperties) {
            const parentValue = this.parentNode[prop];
            this[prop] = this[prop] || parentValue;
            for(const child of children) {
                children[prop] = child[prop] || parentValue;
            }
        }

        if(window.getComputedStyle(this) !== 'none')
            this.onShow();

        this.attachBindings(this);
    }

    onShow() {

    }

    eval(attributeValue, obj, controllerVariables, objectVariables) {
        let toBeEvaluated = attributeValue;
        let args = [];
        for (const variable of controllerVariables) {
            args.push(this.state[variable]);

            toBeEvaluated = toBeEvaluated.replace('this.' + variable, `args[${args.length - 1}]`);
        }

        for (let variable of objectVariables) {
            const indexOnly = variable.endsWith('.index');
            if(indexOnly)
                variable = variable.replace('.index', '');

            if(obj[variable] && obj[variable].length === 2) {
                const index = obj[variable][0];
                const array = obj[variable][1];
                if(indexOnly)
                    toBeEvaluated = toBeEvaluated.replace('local.' + variable + '.index', index);
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
            result = window.eval.call(window,'(function (args) {return ' + toBeEvaluated + '})')(args);
        } catch (e) {
            result = "";
        }

        return result;
    }

    attachBindings(elem) {
        const objects = TSFRepository.getRelevantChildren(elem);

        // Set up ifs
        for (const obj of objects.filter(e => Array.from(e.attributes).filter(({ name, value }) => name.startsWith('tsf-if')).length)) {
                const attributeValue = obj.getAttribute('tsf-if');; // Value to be evaluated
                const controllerVariables = [];
                const objectVariables = [];

                const controllerVariablesRegex = /this\.(.[A-z|_]+)/g;
                const objectVariablesRegex = /local\.(.[A-z|_|\.]+)/g;

                let match;
                while ((match = controllerVariablesRegex.exec(attributeValue)) !== null) {
                    controllerVariables.push(match[1]);
                }

                while ((match = objectVariablesRegex.exec(attributeValue)) !== null) {
                    objectVariables.push(match[1]);
                }

                const display = obj.getAttribute('tsf-if-display') || "block";

                // Set initial value
                if (this.eval(attributeValue, obj, controllerVariables, objectVariables)) {
                    obj.style.display = display;
                    for(const customElement of TSFRepository.getCustomElements(obj)) {
                        customElement.onShow();
                    }
                } else {
                    obj.style.display = "none";
                }
                // Listen for changes in the JS variable and transfer them to the DOM
                for (const variableName of controllerVariables) {
                    const f = () => {
                        if (this.eval(attributeValue, obj, controllerVariables, objectVariables)) {
                            obj.style.display = display;
                            for(const customElement of TSFRepository.getCustomElements(obj)) {
                                if(customElement.onShow)
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
            const variableName = obj.getAttribute('tsf-value');

            // Listen for changes in the JS variable and transfer them to the DOM
            this.state.registerDomChangeListener(variableName, value => {
                obj.value = value;
            });

            this.state.registerJsChangeListener(variableName, val => {
                this.state[variableName] = val;
            });

            // Listen for changes in the DOM and transfer them to js
            obj.oninput = event => {
                const newValue = obj.value;
                obj.value = this.state[variableName]; // Keep old value until js value changes
                this.state._jsChange[variableName](newValue);
            }
        }

        // Set up innerHTML binding
        for (const obj of objects.filter(e => Array.from(e.attributes).filter(({ name, value }) => name === 'tsf-html').length)) {
            const attributeValue = obj.getAttribute('tsf-html'); // Value to be evaluated
            let renderFunction = obj.getAttribute('tsf-html-render');
            const controllerVariables = [];
            const objectVariables = [];

            const controllerVariablesRegex = /this\.(.[A-z|_]+)/g;
            const objectVariablesRegex = /local\.(.[A-z|_|\.]+)/g;

            let match;
            while ((match = controllerVariablesRegex.exec(attributeValue)) !== null) {
                controllerVariables.push(match[1]);
            }

            while ((match = objectVariablesRegex.exec(attributeValue)) !== null) {
                objectVariables.push(match[1]);
            }

            let that = window;
            if (renderFunction && renderFunction.startsWith('this.')) {
                that = this;
                renderFunction = renderFunction.substr(5);
            }

            // Set initial value
            obj.innerHTML = renderFunction ? that[renderFunction].call(that, this.eval(attributeValue, obj, controllerVariables, objectVariables)) : this.eval(attributeValue, obj, controllerVariables, objectVariables);
            // Listen for changes in the JS variable and transfer them to the DOM
            for (const variableName of controllerVariables) {
                const f = () => {
                    obj.innerHTML = renderFunction ? that[renderFunction].call(that, this.eval(attributeValue, obj, controllerVariables, objectVariables)) : this.eval(attributeValue, obj, controllerVariables, objectVariables);
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
                const controllerVariables = [];
                const objectVariables = [];

                const controllerVariablesRegex = /this\.(.[A-z|_]+)/g;
                const objectVariablesRegex = /local\.(.[A-z|_|\.]+)/g;

                let match;
                while ((match = controllerVariablesRegex.exec(attributeValue)) !== null) {
                    controllerVariables.push(match[1]);
                }

                while ((match = objectVariablesRegex.exec(attributeValue)) !== null) {
                    objectVariables.push(match[1]);
                }

                // Set initial value
                obj.setAttribute(attributeName, this.eval(attributeValue, obj, controllerVariables, objectVariables));
                // Listen for changes in the JS variable and transfer them to the DOM
                for (const variableName of controllerVariables) {
                    const f = () => {
                        obj.setAttribute(attributeName, this.eval(attributeValue, obj, controllerVariables, objectVariables));
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
                const controllerVariables = [];
                const objectVariables = [];

                const controllerVariablesRegex = /this\.(.[A-z|_]+)/g;
                const objectVariablesRegex = /local\.(.[A-z|_|\.]+)/g;

                let match;
                while ((match = controllerVariablesRegex.exec(attributeValue)) !== null) {
                    controllerVariables.push(match[1]);
                }

                while ((match = objectVariablesRegex.exec(attributeValue)) !== null) {
                    objectVariables.push(match[1]);
                }

                // Set initial value
                if (this.eval(attributeValue, obj, controllerVariables, objectVariables)) {
                    obj.setAttribute(attributeName, null);
                } else {
                    obj.removeAttribute(attributeName);
                }
                // Listen for changes in the JS variable and transfer them to the DOM
                for (const variableName of controllerVariables) {
                    const f = () => {
                        if (this.eval(attributeValue, obj, controllerVariables, objectVariables)) {
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
                const controllerVariables = [];
                const objectVariables = [];

                const controllerVariablesRegex = /this\.(.[A-z|_]+)/g;
                const objectVariablesRegex = /local\.(.[A-z|_|\.]+)/g;

                let match;
                while ((match = controllerVariablesRegex.exec(attributeValue)) !== null) {
                    controllerVariables.push(match[1]);
                }

                while ((match = objectVariablesRegex.exec(attributeValue)) !== null) {
                    objectVariables.push(match[1]);
                }

                // Set initial value
                if (this.eval(attributeValue, obj, controllerVariables, objectVariables)) {
                    obj.classList.add(attributeName);
                } else {
                    obj.classList.remove(attributeName);
                }
                // Listen for changes in the JS variable and transfer them to the DOM
                for (const variableName of controllerVariables) {
                    const f = () => {
                        if (this.eval(attributeValue, obj, controllerVariables, objectVariables)) {
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
                const controllerVariables = [];
                const objectVariables = [];

                if (variableName) {
                    const controllerVariablesRegex = /this\.(.[A-z|_]+)/g;
                    const objectVariablesRegex = /local\.(.[A-z|_|\.]+)/g;

                    let match;
                    while ((match = controllerVariablesRegex.exec(variableName[1])) !== null) {
                        controllerVariables.push(match[1]);
                    }

                    while ((match = objectVariablesRegex.exec(variableName[1])) !== null) {
                        objectVariables.push(match[1]);
                    }

                    functionName = functionName.replace(variableName[0], "");
                }

                let that = window;
                if (functionName.startsWith('this.')) {
                    that = this;
                    functionName = functionName.substr(5);
                }

                obj.addEventListener(eventName, e => {
                    if (variableName) {
                        that[functionName].call(that, e, this.eval(variableName[1], obj, controllerVariables, objectVariables));
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

            let template = document.createElement('template');
            template.innerHTML = obj.innerHTML;
            while (obj.firstChild) {
                obj.removeChild(obj.firstChild);
            }

            if(this.state[variableName] && this.state[variableName].length > 1) {
                const value = this.state[variableName] ;
                for (let index = 0; index < value.length; index++) {
                    const node = template.content.cloneNode(true);
                    obj.appendChild(node);
    
                    for (const child of obj.querySelectorAll('*')) {
                        child[loopName] = child[loopName] || [index, value];
                    }
                }
                this.attachBindings(obj);
            }

            // Listen for changes in the JS variable and transfer them to the DOM
            this.state.registerDomChangeListener(variableName, value => {
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

    mapProperties(obj, template) {
        const result = [];

        for(let prop of Object.keys(obj)) {
            template[prop] = obj[prop];
        }

        if(template.nodeName.startsWith('TSF-'))
            result.push(template);

        for(let i = 0; i < obj.children.length; i++) {
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