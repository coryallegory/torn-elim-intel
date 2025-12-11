window.state = {
    apikey: "",
    user: null,
    teams: [],
    selectedTeamId: null,

    teamPlayers: {},
    teamPlayersTimestamp: {},
    metadataTimestamp: 0,

    METADATA_REFRESH_MS: 30000,
    TEAM_REFRESH_MS: 30000,
    MIN_REFRESH_MS: 10000,

    loadFromStorage() {
        this.apikey = localStorage.getItem("apikey") || "";
        try {
            const playersRaw = localStorage.getItem("teamPlayers");
            const playerTimestampsRaw = localStorage.getItem("teamPlayersTimestamp");
            const metadataTs = localStorage.getItem("metadataTimestamp");

            this.teamPlayers = playersRaw ? JSON.parse(playersRaw) : {};
            this.teamPlayersTimestamp = playerTimestampsRaw ? JSON.parse(playerTimestampsRaw) : {};
            this.metadataTimestamp = metadataTs ? parseInt(metadataTs, 10) : 0;
        } catch (err) {
            console.error("Failed to restore cached state", err);
            this.teamPlayers = {};
            this.teamPlayersTimestamp = {};
            this.metadataTimestamp = 0;
        }
    },

    saveApiKey(key) {
        this.apikey = key;
        localStorage.setItem("apikey", key);
    },

    cacheMetadata(user, teams) {
        this.user = user;
        this.teams = teams;
        this.metadataTimestamp = Date.now();
        localStorage.setItem("metadataTimestamp", this.metadataTimestamp.toString());
    },

    cacheTeamPlayers(teamId, players) {
        this.teamPlayers[teamId] = players;
        this.teamPlayersTimestamp[teamId] = Date.now();
        localStorage.setItem("teamPlayers", JSON.stringify(this.teamPlayers));
        localStorage.setItem("teamPlayersTimestamp", JSON.stringify(this.teamPlayersTimestamp));
    },

    shouldRefreshMetadata(now = Date.now()) {
        if (now - this.metadataTimestamp < this.MIN_REFRESH_MS) return false;
        return now - this.metadataTimestamp >= this.METADATA_REFRESH_MS;
    },

    shouldRefreshTeam(teamId, now = Date.now()) {
        const last = this.teamPlayersTimestamp[teamId] || 0;
        if (now - last < this.MIN_REFRESH_MS) return false;
        return now - last >= this.TEAM_REFRESH_MS;
    }
};

// legacy handle
window.AppState = window.state;
