window.AppState = {
    apikey: "",
    user: null,
    teams: [],
    selectedTeamId: null,

    // caches
    teamPlayers: {},             // teamId → array
    teamPlayersTimestamp: {},    // teamId → epoch ms

    metadataTimestamp: 0,

    // refresh cycles
    METADATA_REFRESH_MS: 30000,
    TEAM_REFRESH_MS: 30000,
    MIN_REFRESH_MS: 10000,   // avoid API spam

    loadFromStorage() {
        this.apikey = localStorage.getItem("apikey") || "";
    },

    saveApiKey(key) {
        this.apikey = key;
        localStorage.setItem("apikey", key);
    },

    shouldRefreshMetadata() {
        const now = Date.now();
        return now - this.metadataTimestamp > this.METADATA_REFRESH_MS;
    },

    shouldRefreshTeam(teamId) {
        const now = Date.now();
        const last = this.teamPlayersTimestamp[teamId] || 0;
        return now - last > this.TEAM_REFRESH_MS;
    }
};
