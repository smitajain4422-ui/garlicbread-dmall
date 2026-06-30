export default async function handler(req, res) {
    const KV_URL = process.env.nosify_db_KV_REST_API_URL || process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.nosify_db_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN;

    async function getDB() {
        if (!KV_URL) return { chat: [], cloudData: {}, keys: [] };
        const resp = await fetch(`${KV_URL}/get/nosify_dmall_global`, { headers: { Authorization: `Bearer ${KV_TOKEN}` }});
        const data = await resp.json();
        return data.result ? JSON.parse(data.result) : { chat: [], cloudData: {}, keys: [] };
    }

    async function saveDB(db) {
        if (!KV_URL) return;
        await fetch(`${KV_URL}/set/nosify_dmall_global`, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` }, body: JSON.stringify(db) });
    }

    if (req.method === 'GET') {
        let db = await getDB();
        return res.status(200).json(db.chat.slice(0, 50)); 
    }

    if (req.method === 'POST') {
        const { action, data, key } = req.body;

        // Discord Proxy
        if (action === 'discord_proxy') {
            try {
                let dRes = await fetch(data.url, {
                    method: data.method,
                    headers: { 'Authorization': `Bot ${data.token}`, 'Content-Type': 'application/json' },
                    body: data.body ? JSON.stringify(data.body) : undefined
                });
                let dData = await dRes.json();
                return res.status(dRes.status).json(dData);
            } catch (e) { return res.status(500).json({ error: "Proxy connection failed." }); }
        }

        let db = await getDB();
        
        // Chat & Cloud Sync
        if (action === 'send_chat') { db.chat.unshift(data); if (db.chat.length > 50) db.chat.pop(); }
        if (action === 'sync_cloud' && key) { 
            if(!db.cloudData) db.cloudData = {}; 
            db.cloudData[key] = data; 
        }
        
        // Verify Key (For Auto-Kick)
        if (action === 'verify_key') {
            if (!db.keys) return res.status(200).json({ valid: false });
            let k = db.keys.find(x => x.key === key);
            if (!k) return res.status(200).json({ valid: false });
            if (k.expires && Date.now() > k.expires) return res.status(200).json({ valid: false });
            return res.status(200).json({ valid: true });
        }

        // Headless Launch Commands
        if (action === 'launch_campaign') {
            if(!db.cloudData) db.cloudData = {};
            db.cloudData.activeJob = data; 
        }
        if (action === 'kill_campaign') {
            if(db.cloudData && db.cloudData.activeJob) db.cloudData.activeJob.status = "killed";
        }

        await saveDB(db);
        return res.status(200).json({ success: true });
    }
                }
                
