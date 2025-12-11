const fs = require("fs");

function loadApi() {
    const script = fs.readFileSync(require.resolve("../js/api.js"), "utf8");
    // eslint-disable-next-line no-eval
    eval(script);
}

describe("API wrapper", () => {
    beforeEach(() => {
        loadApi();
    });

    test("uses Authorization header for user profile", async () => {
        fetch.mockResolvedValue({ json: async () => ({ profile: {} }) });
        await window.api.getUser("ABC123");
        expect(fetch).toHaveBeenCalledWith("https://api.torn.com/v2/user/profile", {
            headers: { Authorization: "Bearer ABC123" }
        });
    });

    test("composes team players URL with pagination", async () => {
        fetch.mockResolvedValue({ json: async () => ({ eliminationteam: [] }) });
        await window.api.getTeamPlayers(99, 100, "KEY");
        expect(fetch).toHaveBeenCalledWith(
            "https://api.torn.com/v2/torn/99/eliminationteam?limit=100&offset=100",
            { headers: { Authorization: "Bearer KEY" } }
        );
    });

    test("returns error object when payload contains error", async () => {
        fetch.mockResolvedValue({ json: async () => ({ error: { code: 1, error: "Bad" } }) });
        const result = await window.api.getTeams("BAD");
        expect(result).toEqual({ error: { code: 1, error: "Bad" } });
    });
});
