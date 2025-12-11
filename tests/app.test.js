const fs = require("fs");

function loadState() {
    const script = fs.readFileSync(require.resolve("../js/state.js"), "utf8");
    // eslint-disable-next-line no-eval
    eval(script);
}

function loadApp() {
    const script = fs.readFileSync(require.resolve("../js/app.js"), "utf8");
    // eslint-disable-next-line no-eval
    eval(script);
}

function setupDom() {
    document.body.innerHTML = `
        <div id="app-container">
            <input id="apikey-input">
            <button id="apikey-apply"></button>
            <span id="apikey-status"></span>
            <div id="userinfo-box" class="hidden"></div>
            <div id="user-info-content"></div>
            <table><tbody id="team-table-body"></tbody></table>
            <span id="metadata-refresh-timer"></span>
            <span id="metadata-refresh-icon"></span>
            <span id="team-refresh-timer"></span>
            <span id="team-refresh-icon"></span>
            <div id="player-section">
                <input id="level-min" value="0">
                <input id="level-max" value="100">
                <input type="checkbox" id="filter-okay-only">
                <input type="checkbox" id="filter-include-traveling" checked>
                <input type="checkbox" id="filter-include-abroad" checked>
                <table><tbody id="player-table-body"></tbody></table>
            </div>
        </div>
    `;
}

describe("app rendering", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        setupDom();
        window.api = {
            getUser: jest.fn(),
            getTeams: jest.fn(),
            getTeamPlayers: jest.fn()
        };
        loadState();
        loadApp();
    });

    test("filters traveling and abroad players", () => {
        window.state.selectedTeamId = "7";
        window.state.teamPlayers["7"] = [
            { id: 1, name: "ok", level: 10, status: { state: "Okay", description: "Okay" }, last_action: { relative: "" }, attacks: 0, score: 0 },
            { id: 2, name: "travel", level: 20, status: { state: "Traveling", description: "Traveling" }, last_action: { relative: "" }, attacks: 0, score: 0 },
            { id: 3, name: "abroad", level: 30, status: { state: "Abroad", description: "Abroad" }, last_action: { relative: "" }, attacks: 0, score: 0 }
        ];

        document.getElementById("filter-include-traveling").checked = false;
        document.getElementById("filter-include-abroad").checked = false;

        window.app.renderPlayers();
        const rows = document.querySelectorAll("#player-table-body tr");
        expect(rows.length).toBe(1);
        expect(rows[0].children[1].textContent).toBe("ok");
    });

    test("hospital countdown colors degrade to red", () => {
        const base = 1000 * 1000;
        jest.setSystemTime(base);
        window.state.selectedTeamId = "5";
        window.state.teamPlayers["5"] = [
            {
                id: 10,
                name: "hurt",
                level: 50,
                status: { state: "Hospital", description: "Hospital", until: (base / 1000) + 5 },
                last_action: { relative: "" },
                attacks: 0,
                score: 0
            }
        ];

        window.app.renderPlayers();
        jest.advanceTimersByTime(6000);
        const badge = document.querySelector("[data-until]");
        expect(badge.className).toBe("state-red");
        expect(badge.textContent.startsWith("-")).toBe(true);
    });

    test("maintains row order on refresh", () => {
        window.state.selectedTeamId = "2";
        window.state.teamPlayers["2"] = [
            { id: 1, name: "alpha", level: 1, status: { state: "Okay", description: "Okay" }, last_action: { relative: "" }, attacks: 0, score: 0 },
            { id: 2, name: "bravo", level: 2, status: { state: "Okay", description: "Okay" }, last_action: { relative: "" }, attacks: 0, score: 0 }
        ];
        window.app.renderPlayers();

        const firstRender = Array.from(document.querySelectorAll("#player-table-body tr")).map(r => r.children[1].textContent);
        window.state.teamPlayers["2"] = [
            { id: 1, name: "alpha", level: 1, status: { state: "Okay", description: "Okay" }, last_action: { relative: "" }, attacks: 0, score: 0 },
            { id: 2, name: "bravo", level: 2, status: { state: "Okay", description: "Okay" }, last_action: { relative: "" }, attacks: 0, score: 0 }
        ];
        window.app.renderPlayers();
        const secondRender = Array.from(document.querySelectorAll("#player-table-body tr")).map(r => r.children[1].textContent);
        expect(secondRender).toEqual(firstRender);
    });
});
