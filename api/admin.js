// api/admin.js
export default async function handler(req, res) {
    if (req.headers.authorization !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });
    
    const KV_URL = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;

    if (req.method === 'GET' && req.query.spy) {
        // CHANGED: nosify_dmall_global
        const resp = await fetch(`${KV_URL}/get/nosify_dmall_global`, { headers: { Authorization: `Bearer ${KV_TOKEN}` }});
        const data = await resp.json();
        return res.status(200).json(data.result ? JSON.parse(data.result).cloudData : {});
    }

    async function getDB() {
        // CHANGED: nosify_dmall_data
        const resp = await fetch(`${KV_URL}/get/nosify_dmall_data`, { headers: { Authorization: `Bearer ${KV_TOKEN}` }});
        const data = await resp.json();
        return data.result ? JSON.parse(data.result) : { keys: [], bans: [], logs: [] };
    }
    async function saveDB(db) {
        await fetch(`${KV_URL}/set/nosify_dmall_data`, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` }, body: JSON.stringify(db) });
    }

    if (req.method === 'GET') return res.status(200).json(await getDB());

    if (req.method === 'POST') {
        const { action, payload } = req.body;
        let db = await getDB();
        if (action === 'create_key') db.keys.push(payload);
        if (action === 'delete_key') db.keys.splice(payload, 1);
        if (action === 'ban_device' && !db.bans.includes(payload)) db.bans.push(payload);
        await saveDB(db);
        return res.status(200).json({ success: true });
    }
}
    
