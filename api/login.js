// api/login.js
export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });
    
    const { key, deviceId } = req.body;
    const ADMIN_PASS = process.env.ADMIN_PASSWORD;

    if (key === ADMIN_PASS) return res.status(200).json({ success: true, role: "admin" });

    const KV_URL = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;

    if (!KV_URL || !KV_TOKEN) return res.status(500).json({ success: false, error: "Database connection tokens missing." });

    try {
        // CHANGED: Now uses nosify_dmall_data to avoid chat app conflict
        const resp = await fetch(`${KV_URL}/get/nosify_dmall_data`, { headers: { Authorization: `Bearer ${KV_TOKEN}` }});
        const data = await resp.json();
        let db = data.result ? JSON.parse(data.result) : { keys: [], bans: [], logs: [] };

        if (db.bans && db.bans.includes(deviceId)) return res.status(403).json({ success: false, error: "Device is banned." });

        let keyObj = db.keys.find(k => k.key === key);
        if (!keyObj) return res.status(401).json({ success: false, error: "Invalid key." });

        if (keyObj.claimedBy && keyObj.claimedBy !== deviceId) return res.status(403).json({ success: false, error: "This key is locked to another device." });
        if (keyObj.expires && new Date().getTime() > keyObj.expires) return res.status(403).json({ success: false, error: "Key expired." });
        if (keyObj.left !== 'perm' && keyObj.left <= 0) return res.status(403).json({ success: false, error: "No uses left on this key." });

        if (!keyObj.claimedBy && keyObj.key !== 'FREE') keyObj.claimedBy = deviceId;
        
        if (!db.logs) db.logs = [];
        db.logs.unshift({ time: new Date().toLocaleString(), key: key, device: deviceId });
        if (db.logs.length > 50) db.logs.pop(); 

        await fetch(`${KV_URL}/set/nosify_dmall_data`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${KV_TOKEN}` },
            body: JSON.stringify(db)
        });

        return res.status(200).json({ success: true, role: "user", left: keyObj.left, max: keyObj.max, expires: keyObj.expires });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Internal database read error." });
    }
                                                                                     }
