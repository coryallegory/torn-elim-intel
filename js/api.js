window.api = {
    BASE: "https://api.torn.com/v2",
    FF_BASE: "https://ffscouter.com/api/v1",

    async request(url, apikey) {
        try {
            const res = await fetch(url, {
                headers: {
                    Accept: "application/json",
                    Authorization: `ApiKey ${apikey}`
                }
            });
            const data = await res.json();

            // Log errors
            if (data.error) {
                console.error("API Error:", data.error);
                return { error: data.error };
            }

            return data;
        } catch (err) {
            console.error("Network/API exception:", err);
            return { error: { code: -1, error: "Network error" } };
        }
    },

    getUser(apikey) {
        return this.request(`${this.BASE}/user/basic?striptags=true`, apikey);
    },

    getTeams(apikey) {
        return this.request(`${this.BASE}/torn/elimination`, apikey);
    },

    getTeamPlayers(teamId, offset, apikey) {
        const offsetParam = offset ? `&offset=${offset}` : "";
        return this.request(`${this.BASE}/torn/${teamId}/eliminationteam?limit=100${offsetParam}`, apikey);
    },

    async requestFf(url) {
        try {
            const res = await fetch(url, {
                headers: {
                    Accept: "application/json"
                }
            });
            const data = await res.json();
            if (data.error) {
                console.error("FFScouter API Error:", data.error);
            }
            return data;
        } catch (err) {
            console.error("FFScouter network/API exception:", err);
            return { error: { code: -1, error: "Network error" } };
        }
    },

    checkFfKey(key) {
        return this.requestFf(`${this.FF_BASE}/check-key?key=${encodeURIComponent(key)}`);
    },

    getFfStats(key, playerIdsCsv) {
        return this.requestFf(`${this.FF_BASE}/get-stats?key=${encodeURIComponent(key)}&targets=${playerIdsCsv}`);
    }
};

// legacy handle
window.TornAPI = window.api;
