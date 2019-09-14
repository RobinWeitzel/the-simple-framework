TSFRepository.registerComponent(class Example extends TSFComponent {
    constructor() {
        super();
        this.state.counter = 0;
    }

    click() {
        this.state.counter += 1;
    }
});