// api/app.js
export default async function handler(req, res) {
    const KV_URL = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;

    async function getDB() {
        // CHANGED: nosify_dmall_global
        const resp = await fetch(`${KV_URL}/get/nosify_dmall_global`, { headers: { Authorization: `Bearer ${KV_TOKEN}` }});
        const data = await resp.json();
        return data.result ? JSON.parse(data.result) : { chat: [], cloudData: {} };
    }
    async function saveDB(db) {
        await fetch(`${KV_URL}/set/nosify_dmall_global`, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` }, body: JSON.stringify(db) });
    }

    if (req.method === 'GET') {
        let db = await getDB();
        return res.status(200).json(db.chat.slice(0, 50)); 
    }

    if (req.method === 'POST') {
        const { action, data, key } = req.body;
        let db = await getDB();

        if (action === 'send_chat') {
            db.chat.unshift(data);
            if (db.chat.length > 50) db.chat.pop();
        }
        if (action === 'sync_cloud' && key) {
            if(!db.cloudData) db.cloudData = {};
            db.cloudData[key] = data; 
        }

        await saveDB(db);
        return res.status(200).json({ success: true });
    }
}
