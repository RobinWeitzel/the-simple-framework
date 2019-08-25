class TSFRepository {
    static classes = new Map();

    static registerClass(c) {
        TSFRepository.classes.set(c.name, c);
    }

    static getClass(name) {
        return TSFRepository.classes.get(name);
    }

    static afterLoad() {
        
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

class TSFView extends HTMLElement {
    constructor() {
        super();

        this.state = new Proxy(new TSFProxy, TSFProxy.handler());
        this.attachBindings(this);
    }

    eval(attributeValue, obj, controllerVariables, objectVariables) {
        let toBeEvaluated = attributeValue;
        for (const variable of controllerVariables) {
            let value = this.state[variable];
            if (typeof value === "string") {
                if (toBeEvaluated.startsWith("'"))
                    value = '"' + value + '"';
                else
                    value = "'" + value + "'";
            }
            toBeEvaluated = toBeEvaluated.replace('this.' + variable, value);
        }

        for (const variable of objectVariables) {
            if(obj[variable] && obj[variable].length === 2) {
                const index = obj[variable][0];
                const array = obj[variable][1];
                toBeEvaluated = toBeEvaluated.replace('local.' + variable, array[index]);
            } else {
                toBeEvaluated = toBeEvaluated.replace('local.' + variable, "");
            }
        }

        let result;
        try {
            result = eval(toBeEvaluated);
        } catch (e) {
            result = "";
        }

        return result;
    }

    attachBindings(elem) {
        // Set up value binding
        for (const obj of elem.querySelectorAll('*[tsf-value]')) {
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
        for (const obj of elem.querySelectorAll('*[tsf-html]')) {
            const attributeValue = obj.getAttribute('tsf-html'); // Value to be evaluated
            let renderFunction = obj.getAttribute('tsf-html-render');
            const controllerVariables = [];
            const objectVariables = [];

            const controllerVariablesRegex = /this\.(.[A-z|_]+)/g;
            const objectVariablesRegex = /local\.(.[A-z|_]+)/g;

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
                this.state.registerDomChangeListener(variableName, () => {
                    obj.innerHTML = renderFunction ? that[renderFunction].call(that, this.eval(attributeValue, obj, controllerVariables, objectVariables)) : this.eval(attributeValue, obj, controllerVariables, objectVariables);
                });
            }
        }

        // Set up attribute bindings
        for (const obj of Array.from(elem.querySelectorAll('*'))
            .filter(
                e => Array.from(e.attributes).filter(
                    ({ name, value }) => name.startsWith('tsf-bind-attribute-')).length
            )) {
            const attributes = Array.from(obj.attributes).filter(({ name, value }) => name.startsWith('tsf-bind-attribute-'));

            for (const attribute of attributes) {
                const attributeName = attribute.name.substr(19);
                const attributeValue = attribute.value; // Value to be evaluated
                const controllerVariables = [];
                const objectVariables = [];

                const controllerVariablesRegex = /this\.(.[A-z|_]+)/g;
                const objectVariablesRegex = /local\.(.[A-z|_]+)/g;

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
                    this.state.registerDomChangeListener(variableName, () => {
                        obj.setAttribute(attributeName, this.eval(attributeValue, obj, controllerVariables, objectVariables));
                    });
                }
            }
        }

        // Set up boolean attribute bindings
        for (const obj of Array.from(elem.querySelectorAll('*'))
            .filter(
                e => Array.from(e.attributes).filter(
                    ({ name, value }) => name.startsWith('tsf-bind-boolean-attribute-')).length
            )) {
            const attributes = Array.from(obj.attributes).filter(({ name, value }) => name.startsWith('tsf-bind-boolean-attribute-'));

            for (const attribute of attributes) {
                const attributeName = attribute.name.substr(27);
                const attributeValue = attribute.value; // Value to be evaluated
                const controllerVariables = [];
                const objectVariables = [];

                const controllerVariablesRegex = /this\.(.[A-z|_]+)/g;
                const objectVariablesRegex = /local\.(.[A-z|_]+)/g;

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
                    this.state.registerDomChangeListener(variableName, () => {
                        if (this.eval(attributeValue, obj, controllerVariables, objectVariables)) {
                            obj.setAttribute(attributeName, null);
                        } else {
                            obj.removeAttribute(attributeName);
                        }
                    });
                }
            }
        }

        // Set up function bindings
        for (const obj of Array.from(elem.querySelectorAll('*'))
            .filter(
                e => Array.from(e.attributes).filter(
                    ({ name, value }) => name.startsWith('tsf-bind-function-')).length
            )) {
            const attributes = Array.from(obj.attributes).filter(({ name, value }) => name.startsWith('tsf-bind-function-'));

            for (const attribute of attributes) {
                const eventName = attribute.name.substr(18);
                let functionName = attribute.value;
                let variableName = /\((.+?)\)/.exec(functionName);

                if (variableName) {
                    const controllerVariables = [];
                    const objectVariables = [];

                    const controllerVariablesRegex = /this\.(.[A-z|_]+)/g;
                    const objectVariablesRegex = /local\.(.[A-z|_]+)/g;

                    let match;
                    while ((match = controllerVariablesRegex.exec(variableName[1])) !== null) {
                        controllerVariables.push(match[1]);
                    }

                    while ((match = objectVariablesRegex.exec(variableName[1])) !== null) {
                        objectVariables.push(match[1]);
                    }
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
        for (const obj of elem.querySelectorAll('*[tsf-for-of]')) {
            const attributeContent = obj.getAttribute('tsf-for-of');
            const loopName = attributeContent.split('of')[0].trim();
            const variableName = attributeContent.split('of')[1].trim();

            let template = document.createElement('template');
            template.innerHTML = obj.innerHTML;
            while (obj.firstChild) {
                obj.removeChild(obj.firstChild);
            }

            // Listen for changes in the JS variable and transfer them to the DOM
            this.state.registerDomChangeListener(variableName, value => {
                while (obj.firstChild) {
                    obj.removeChild(obj.firstChild);
                }

                let index = 0;
                for (const element of value) {
                    const node = template.content.cloneNode(true);
                    obj.appendChild(node);

                    for (const child of obj.querySelectorAll('*:last-child *')) {
                        child[loopName] = child[loopName] || [index, value];
                    }

                    index++;
                }
                this.attachBindings(obj);
            });
        }
    }
}

const parseDom = event => {
    const customElements = document.evaluate("//*[starts-with(name(),'tsf-')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

    for (let i = 0; i < customElements.snapshotLength; i++) {
        const node = customElements.snapshotItem(i);
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