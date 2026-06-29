// api/app.js
export default async function handler(req, res) {
    const KV_URL = process.env.nosify_db_KV_REST_API_URL;
    const KV_TOKEN = process.env.nosify_db_KV_REST_API_TOKEN;

    async function getDB() {
        const resp = await fetch(`${KV_URL}/get/nosify_global`, { headers: { Authorization: `Bearer ${KV_TOKEN}` }});
        const data = await resp.json();
        return data.result ? JSON.parse(data.result) : { chat: [], cloudData: {} };
    }
    async function saveDB(db) {
        await fetch(`${KV_URL}/set/nosify_global`, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` }, body: JSON.stringify(db) });
    }

    if (req.method === 'GET') {
        let db = await getDB();
        return res.status(200).json(db.chat.slice(0, 50)); // Return last 50 messages
    }

    if (req.method === 'POST') {
        const { action, data, key } = req.body;
        let db = await getDB();

        if (action === 'send_chat') {
            db.chat.unshift(data);
            if (db.chat.length > 50) db.chat.pop();
        }
        if (action === 'sync_cloud' && key) {
            db.cloudData[key] = data; // Saves user's token count under their key
        }

        await saveDB(db);
        return res.status(200).json({ success: true });
    }
                                 }
  
