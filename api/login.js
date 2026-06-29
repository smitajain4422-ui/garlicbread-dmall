// api/login.js
export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });
    
    const { key, deviceId } = req.body;
    const ADMIN_PASS = process.env.ADMIN_PASSWORD;

    // 1. Check if it's the Admin logging in
    if (key === ADMIN_PASS) return res.status(200).json({ success: true, role: "admin" });

    // 2. Setup Database Connection 
    // (Using a fallback just in case Vercel named your DB without the nosify_db_ prefix)
    const KV_URL = process.env.nosify_db_KV_REST_API_URL || process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.nosify_db_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN;

    // Fail-safe if the database isn't connected properly
    if (!KV_URL || !KV_TOKEN) {
        return res.status(500).json({ success: false, error: "Database connection tokens are missing in Vercel." });
    }

    try {
        // Fetch current keys and bans from the database
        const resp = await fetch(`${KV_URL}/get/nosify_data`, { headers: { Authorization: `Bearer ${KV_TOKEN}` }});
        const data = await resp.json();
        let db = data.result ? JSON.parse(data.result) : { keys: [], bans: [], logs: [] };

        // 3. Security Checks
        if (db.bans && db.bans.includes(deviceId)) return res.status(403).json({ success: false, error: "Device is banned." });

        let keyObj = db.keys.find(k => k.key === key);
        if (!keyObj) return res.status(401).json({ success: false, error: "Invalid key." });

        if (keyObj.claimedBy && keyObj.claimedBy !== deviceId) return res.status(403).json({ success: false, error: "This key is locked to another device." });
        if (keyObj.expires && new Date().getTime() > keyObj.expires) return res.status(403).json({ success: false, error: "Key expired." });
        if (keyObj.left !== 'perm' && keyObj.left <= 0) return res.status(403).json({ success: false, error: "No uses left on this key." });

        // 4. Lock the key to the user's device if it's their first time logging in
        if (!keyObj.claimedBy && keyObj.key !== 'FREE') keyObj.claimedBy = deviceId;
        
        // 5. Log the login event for the Admin Spy Panel
        if (!db.logs) db.logs = [];
        db.logs.unshift({ time: new Date().toLocaleString(), key: key, device: deviceId });
        if (db.logs.length > 50) db.logs.pop(); // Keep logs clean (max 50)

        // Save everything back to the database
        await fetch(`${KV_URL}/set/nosify_data`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${KV_TOKEN}` },
            body: JSON.stringify(db)
        });

        // Send success back to the website to let them in
        return res.status(200).json({ success: true, role: "user", left: keyObj.left, max: keyObj.max, expires: keyObj.expires });
        
    } catch (err) {
        return res.status(500).json({ success: false, error: "Internal database read error." });
    }
}
