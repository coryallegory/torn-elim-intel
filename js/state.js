window.state = {
    apikey: "",
    ffapikey: "",
    ffApiKeyValid: false,
    rememberApiKey: false,
    rememberFfApiKey: false,
    user: null,
    teams: [],
    selectedTeamId: null,
    selectedPlayersByTeam: {},

    hidePinkPowerTeam: false,

    teamPlayers: {},
    teamPlayersTimestamp: {},
    metadataTimestamp: 0,

    METADATA_REFRESH_MS: 30000,
    TEAM_REFRESH_MS: 30000,
    MIN_REFRESH_MS: 10000,

    loadFromStorage() {
        const rememberApiKeyRaw = localStorage.getItem("rememberApiKey");
        const rememberFfApiKeyRaw = localStorage.getItem("rememberFfApiKey");

        this.rememberApiKey = rememberApiKeyRaw === "true";
        this.rememberFfApiKey = rememberFfApiKeyRaw === "true";

        this.apikey = this.rememberApiKey ? (localStorage.getItem("apikey") || "") : "";
        this.ffapikey = this.rememberFfApiKey ? (localStorage.getItem("ffapikey") || "") : "";
        try {
            const userRaw = localStorage.getItem("user");
            const teamsRaw = localStorage.getItem("teams");
            const playersRaw = localStorage.getItem("teamPlayers");
            const playerTimestampsRaw = localStorage.getItem("teamPlayersTimestamp");
            const metadataTs = localStorage.getItem("metadataTimestamp");
            const selectedTeamRaw = localStorage.getItem("selectedTeamId");

            this.user = userRaw ? JSON.parse(userRaw) : null;
            this.teams = teamsRaw ? JSON.parse(teamsRaw) : [];
            this.teamPlayers = playersRaw ? JSON.parse(playersRaw) : {};
            this.teamPlayersTimestamp = playerTimestampsRaw ? JSON.parse(playerTimestampsRaw) : {};
            this.metadataTimestamp = metadataTs ? parseInt(metadataTs, 10) : 0;
            this.selectedTeamId = selectedTeamRaw ? parseInt(selectedTeamRaw, 10) : null;
            localStorage.removeItem("hidePinkPowerTeam");
            this.hidePinkPowerTeam = false;
        } catch (err) {
            console.error("Failed to restore cached state", err);
            this.teamPlayers = {};
            this.teamPlayersTimestamp = {};
            this.metadataTimestamp = 0;
            this.teams = [];
            this.selectedTeamId = null;
            this.user = null;
            this.hidePinkPowerTeam = false;
        }
    },

    saveApiKey(key, rememberKey = false) {
        this.apikey = key;
        this.rememberApiKey = rememberKey;
        localStorage.setItem("rememberApiKey", rememberKey ? "true" : "false");
        if (rememberKey) {
            localStorage.setItem("apikey", key);
        } else {
            localStorage.removeItem("apikey");
        }
    },

    saveFfApiKey(key, rememberKey = false) {
        this.ffapikey = key;
        this.rememberFfApiKey = rememberKey;
        localStorage.setItem("rememberFfApiKey", rememberKey ? "true" : "false");
        if (rememberKey) {
            localStorage.setItem("ffapikey", key);
        } else {
            localStorage.removeItem("ffapikey");
        }
    },

    clearApiKey() {
        this.apikey = "";
        this.rememberApiKey = false;
        localStorage.removeItem("apikey");
        localStorage.setItem("rememberApiKey", "false");
    },

    clearFfApiKey() {
        this.ffapikey = "";
        this.ffApiKeyValid = false;
        this.rememberFfApiKey = false;
        localStorage.removeItem("ffapikey");
        localStorage.setItem("rememberFfApiKey", "false");
    },

    cacheMetadata(user, teams) {
        this.user = user;
        this.teams = teams;
        this.metadataTimestamp = Date.now();
        localStorage.setItem("metadataTimestamp", this.metadataTimestamp.toString());
        localStorage.setItem("user", JSON.stringify(user || null));
        localStorage.setItem("teams", JSON.stringify(teams || []));
    },

    saveSelectedTeamId(teamId) {
        this.selectedTeamId = teamId;
        if (teamId === null || teamId === undefined) {
            localStorage.removeItem("selectedTeamId");
            return;
        }
        localStorage.setItem("selectedTeamId", teamId.toString());
    },

    hidePinkPowerPermanently() {
        this.hidePinkPowerTeam = false;
        localStorage.removeItem("hidePinkPowerTeam");
    },

    cacheTeamPlayers(teamId, players) {
        this.teamPlayers[teamId] = players;
        this.teamPlayersTimestamp[teamId] = Date.now();

        const storageSafePlayers = {};
        Object.keys(this.teamPlayers).forEach(id => {
            const teamList = this.teamPlayers[id];
            storageSafePlayers[id] = Array.isArray(teamList)
                ? teamList.map(({ rawData, ...rest }) => rest)
                : [];
        });

        localStorage.setItem("teamPlayers", JSON.stringify(storageSafePlayers));
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
