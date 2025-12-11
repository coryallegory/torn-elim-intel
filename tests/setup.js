beforeEach(() => {
    jest.useRealTimers();
    global.fetch = jest.fn();
    localStorage.clear();
    document.body.innerHTML = "";
});
