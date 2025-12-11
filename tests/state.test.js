const fs = require("fs");

function loadState() {
    const script = fs.readFileSync(require.resolve("../js/state.js"), "utf8");
    // eslint-disable-next-line no-eval
    eval(script);
}

describe("state caching", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2024-01-01T00:00:00Z"));
        loadState();
    });

    test("saves and restores api key", () => {
        window.state.saveApiKey("token123");
        expect(localStorage.getItem("apikey")).toBe("token123");

        const newStateScript = fs.readFileSync(require.resolve("../js/state.js"), "utf8");
        eval(newStateScript);
        expect(window.state.apikey).toBe("token123");
    });

    test("persists team players cache with timestamp", () => {
        window.state.cacheTeamPlayers("1", [{ id: 1 }]);
        expect(window.state.teamPlayers["1"]).toHaveLength(1);
        expect(window.state.teamPlayersTimestamp["1"]).toBeDefined();

        const stored = JSON.parse(localStorage.getItem("teamPlayers"));
        expect(stored["1"][0].id).toBe(1);
    });

    test("metadata refresh suppressed when too recent", () => {
        window.state.metadataTimestamp = Date.now();
        jest.setSystemTime(Date.now() + 5000);
        expect(window.state.shouldRefreshMetadata()).toBe(false);
        jest.setSystemTime(Date.now() + 30000);
        expect(window.state.shouldRefreshMetadata()).toBe(true);
    });

    test("team refresh respects minimum window", () => {
        window.state.teamPlayersTimestamp["2"] = Date.now();
        jest.setSystemTime(Date.now() + 9000);
        expect(window.state.shouldRefreshTeam("2")).toBe(false);
        jest.setSystemTime(Date.now() + 31000);
        expect(window.state.shouldRefreshTeam("2")).toBe(true);
    });
});
