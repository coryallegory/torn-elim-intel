window.api = {
    BASE: "https://api.torn.com/v2",

    async request(url, apikey) {
        try {
            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${apikey}`
                }
            });
            const data = await res.json();

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
        return this.request(`${this.BASE}/user/profile`, apikey);
    },

    getTeams(apikey) {
        return this.request(`${this.BASE}/torn/elimination`, apikey);
    },

    getTeamPlayers(teamId, offset, apikey) {
        return this.request(
            `${this.BASE}/torn/${teamId}/eliminationteam?limit=100&offset=${offset}`,
            apikey
        );
    }
};

// legacy handle
window.TornAPI = window.api;
