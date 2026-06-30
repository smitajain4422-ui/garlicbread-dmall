// --- SECURITY & SETUP ---
// Give a warning if they try to close the tab while DMing
window.onbeforeunload = function() {
    if (engineRunning) return "DMall is still running! If you close this, it will pause. Are you sure?";
};

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
let terminalLogs = JSON.parse(localStorage.getItem('nosify_dm_logs')) || ["System Booted. Persistent logs active."];

let dmDelay = parseInt(localStorage.getItem('nosify_dm_delay')) || 200;
let concurrencyLimit = parseInt(localStorage.getItem('nosify_dm_concurrency')) || 20;

let engineRunning = false;
let engineStop = false;

window.onload = () => {
    if (activeKey === "SECURE_ADMIN_TOKEN") {
        showAdminPanel();
    } else if (activeKey) {
        showApp(); renderTokens(); renderEmbeds(); renderBlacklist(); updateStats(); loadLogs();
        $("#cfg-dm-delay").val(dmDelay); $("#cfg-concurrency").val(concurrencyLimit);
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

function saveRateLimits() {
    dmDelay = parseInt($("#cfg-dm-delay").val()) || 200;
    concurrencyLimit = parseInt($("#cfg-concurrency").val()) || 20;
    localStorage.setItem('nosify_dm_delay', dmDelay); localStorage.setItem('nosify_dm_concurrency', concurrencyLimit);
}

// --- DISCORD PROXY CALLER ---
async function discordProxy(url, method, token, body = null) {
    const res = await fetch('/api/app', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discord_proxy', data: { url, method, token, body }})
    });
    return res;
}

// --- TOKEN MANAGER & MASS UPLOAD ---
function addToken() {
    let rawInput = $("#add-token-val").val().trim(); 
    let groupName = $("#add-token-group").val().trim() || "Default Folder";
    if (!rawInput) return;
    let tokensToAdd = [];
    try {
        let parsed = JSON.parse(rawInput);
        if (Array.isArray(parsed)) tokensToAdd = parsed; else tokensToAdd = [rawInput];
    } catch(e) { tokensToAdd = rawInput.split(/[\n\r\s,]+/).map(t => t.replace(/["']/g, "").trim()); }

    let addedCount = 0;
    tokensToAdd.forEach(t => {
        if (t.length > 20 && !tokensDB.find(x => x.token === t)) {
            tokensDB.push({ token: t, group: groupName, status: 'Not Checked', name: 'Unknown Bot', id: null }); addedCount++;
        }
    });

    if (addedCount > 0) {
        localStorage.setItem('nosify_dm_tokens', JSON.stringify(tokensDB));
        $("#add-token-val").val(""); renderTokens(); alert(`Imported ${addedCount} tokens!`);
    } else alert("No valid new tokens found.");
}

function deleteToken(i) { tokensDB.splice(i, 1); localStorage.setItem('nosify_dm_tokens', JSON.stringify(tokensDB)); renderTokens(); }
function clearAllTokens() { if(confirm("Clear all tokens?")) { tokensDB = []; localStorage.setItem('nosify_dm_tokens', '[]'); renderTokens(); }}

async function checkAllTokens() {
    for (let i = 0; i < tokensDB.length; i++) { await checkToken(i, true); await new Promise(r => setTimeout(r, 200)); }
    localStorage.setItem('nosify_dm_tokens', JSON.stringify(tokensDB)); renderTokens();
}

async function checkToken(i, skipRender = false) {
    let tok = tokensDB[i]; $(`#tok-stat-${i}`).text("Checking...");
    try {
        let res = await discordProxy('https://discord.com/api/v10/users/@me', 'GET', tok.token);
        if(res.ok) { let data = await res.json(); tok.status = "Alive ✅"; tok.name = data.username; tok.id = data.id; } 
        else { tok.status = "Dead/Terminated ❌"; tok.id = null; }
    } catch(e) { tok.status = "Error ⚠️"; }
    if(!skipRender) { localStorage.setItem('nosify_dm_tokens', JSON.stringify(tokensDB)); renderTokens(); }
}

function copyInvite(botId) {
    let link = `https://discord.com/oauth2/authorize?client_id=${botId}&permissions=8&integration_type=0&scope=bot`;
    navigator.clipboard.writeText(link); alert("Admin Invite Link copied to clipboard!");
}

function copyAllInvites() {
    let aliveBots = tokensDB.filter(t => t.id && t.status.includes('Alive'));
    if (aliveBots.length === 0) return alert("You have no checked, alive bots to get links for!");
    let links = aliveBots.map(b => `https://discord.com/oauth2/authorize?client_id=${b.id}&permissions=8&integration_type=0&scope=bot`).join('\n');
    navigator.clipboard.writeText(links); alert(`Copied ${aliveBots.length} invite links to your clipboard!`);
}

function renderTokens() {
    let html = "", groups = new Set();
    tokensDB.forEach((t, i) => {
        groups.add(t.group);
        let actionBtns = `<button onclick="checkToken(${i})" class="bg-[#27272a] text-white text-[10px] px-3 py-1.5 rounded-lg mr-2 hover:bg-[#3f3f46]">Check</button>`;
        if(t.status.includes('Alive')) {
            actionBtns += `<button onclick="openBotEditor(${i}, false)" class="bg-[#4f46e5] text-white text-[10px] px-3 py-1.5 rounded-lg mr-2 hover:bg-[#4338ca]">Edit</button>`;
            actionBtns += `<button onclick="copyInvite('${t.id}')" class="bg-green-600/20 border border-green-500/50 text-green-400 text-[10px] px-3 py-1.5 rounded-lg mr-2 hover:bg-green-600/40">Invite</button>`;
        }
        actionBtns += `<button onclick="deleteToken(${i})" class="text-red-400 hover:text-red-500 font-bold text-sm">✕</button>`;
        html += `<tr class="hover:bg-black/10 transition duration-150"><td class="p-3 font-mono truncate max-w-[120px] opacity-80">${t.token}</td><td class="p-3 text-gray-400 font-bold">${t.group}</td><td class="p-3 text-[#6366f1] font-semibold">${t.name}</td><td class="p-3 text-xs opacity-90" id="tok-stat-${i}">${t.status}</td><td class="p-3 text-right whitespace-nowrap">${actionBtns}</td></tr>`;
    });
    $("#token-list").html(html);
    let gHtml = `<option value="">Select Bot Group...</option>`; groups.forEach(g => gHtml += `<option value="${g}">${g}</option>`);
    $("#launch-token-group").html(gHtml);
}

// --- PROFILE EDITOR (SINGLE OR MASS) ---
let isMassEditing = false;
function openBotEditor(index, isMass) {
    isMassEditing = isMass; $("#editor-title").text(isMass ? "Mass Edit ALL Bots" : "Edit Single Bot Profile");
    $("#edit-bot-index").val(index); $("#edit-bot-name").val(""); $("#edit-bot-avatar").val("");
    $("#bot-editor-modal").removeClass("hidden");
}
function openMassBotEditor() {
    let aliveCount = tokensDB.filter(t => t.status.includes('Alive')).length;
    if(aliveCount === 0) return alert("You have no active bots to edit! Check them first.");
    openBotEditor(null, true);
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
        if (base64Img) payload.avatar = base64Img; else alert("Image conversion failed. Proceeding with name only.");
    }

    let botsToEdit = isMassEditing ? tokensDB.filter(t => t.status.includes('Alive')) : [tokensDB[$("#edit-bot-index").val()]];
    for (let b of botsToEdit) {
        try {
            let res = await discordProxy('https://discord.com/api/v10/users/@me', 'PATCH', b.token, payload);
            if(res.ok) { let data = await res.json(); b.name = data.username; }
        } catch(e) {}
        if(isMassEditing) await new Promise(r => setTimeout(r, 1000));
    }
    localStorage.setItem('nosify_dm_tokens', JSON.stringify(tokensDB)); renderTokens();
    btn.text("Push Changes to Discord").prop("disabled", false); closeBotEditor(); alert("Profile update(s) completed!");
}

// --- SERVERS & EMBEDS ---
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
            $("#target-server").html(guilds.length === 0 ? '<option value="">Bot is not in any servers</option>' : guilds.map(g => `<option value="${g.id}">${g.name} (${g.id})</option>`).join(''));
        } else $("#target-server").html('<option value="">Failed to fetch servers</option>');
    } catch(e) { $("#target-server").html('<option value="">Network error</option>'); }
}

function addEmbed() {
    let n = $("#add-embed-name").val().trim(), j = $("#add-embed-json").val().trim();
    if(!n || !j) return;
    try { JSON.parse(j); } catch(e) { return alert("Invalid JSON format."); }
    embedsDB.push({ name: n, json: j }); localStorage.setItem('nosify_dm_embeds', JSON.stringify(embedsDB));
    $("#add-embed-name, #add-embed-json").val(""); renderEmbeds();
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

// --- FILTERS & SYSTEM MANAGEMENT ---
function addBlacklist() {
    let id = $("#add-blacklist-val").val().trim(); if (!id || blacklistDB.includes(id)) return;
    blacklistDB.push(id); localStorage.setItem('nosify_dm_blacklist', JSON.stringify(blacklistDB)); $("#add-blacklist-val").val(""); renderBlacklist();
}
function removeBlacklist(i) { blacklistDB.splice(i, 1); localStorage.setItem('nosify_dm_blacklist', JSON.stringify(blacklistDB)); renderBlacklist(); }
function renderBlacklist() {
    let html = ""; blacklistDB.forEach((id, i) => html += `<div class="flex justify-between p-2 border-b border-[var(--site-border)]"><span class="font-mono text-gray-300">${id}</span><button onclick="removeBlacklist(${i})" class="text-red-400">✕</button></div>`);
    $("#blacklist-list").html(html);
}

function clearSystemData() {
    if (!confirm("HARD RESET: This wipes your sent history, saved targets, and logs so you can run a fresh campaign. Continue?")) return;
    statsDB = { sent: 0, failed: 0 }; localStorage.setItem('nosify_dm_stats', JSON.stringify(statsDB));
    localStorage.removeItem('nosify_dm_targets');
    terminalLogs = ["System Hard Reset. All logs and target memory cleared."]; saveLogs();
    $("#con-sent, #con-failed, #con-scraped").text("0"); $("#con-progress").css("width", "0%"); updateStats();
}
function updateStats() { $("#stat-sent").text(statsDB.sent); $("#stat-failed").text(statsDB.failed); $("#stat-tokens").text(tokensDB.length); }

// --- LOGGING ENGINE (PERSISTENT) ---
function logTerminalOutput(msg, type="info") {
    let color = type === "err" ? "#ef4444" : type === "win" ? "#10B981" : "#a1a1aa";
    let formattedMsg = `<div style="color:${color}; margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.05);">[${new Date().toLocaleTimeString()}] ${msg}</div>`;
    terminalLogs.unshift(formattedMsg);
    if(terminalLogs.length > 300) terminalLogs.pop(); // Keep max 300 logs so browser doesn't lag
    saveLogs();
}
function saveLogs() {
    localStorage.setItem('nosify_dm_logs', JSON.stringify(terminalLogs)); loadLogs();
}
function loadLogs() {
    $("#terminal-output").html(terminalLogs.join(''));
}
function clearTerminalLogs() {
    terminalLogs = ["Logs manually cleared by user."]; saveLogs();
}

// --- DMALL ENGINE (REAL DISCORD SCRAPE & SEND) ---
function promptDmall() {
    if ($("#auto-leave-toggle").is(":checked")) $("#leave-warning-modal").removeClass("hidden"); else executeDmall();
}
function cancelDmall() { $("#leave-warning-modal").addClass("hidden"); }
function confirmDmall() { $("#leave-warning-modal").addClass("hidden"); executeDmall(); }

async function executeDmall() {
    if(engineRunning) return alert("DMall is already running!");
    let group = $("#launch-token-group").val();
    let serverId = $("#target-server").val();
    let autoLeave = $("#auto-leave-toggle").is(":checked");
    let embedIdx = $("#launch-embed").val();
    let audience = $("#launch-audience").val();
    
    if(!group || !serverId || !embedIdx) return alert("Please fill all setup fields.");
    
    let bots = tokensDB.filter(t => t.group === group && t.status.includes('Alive'));
    if(bots.length === 0) return alert("No active bots in folder!");
    
    let rawEmbedJson = embedsDB[embedIdx].json;
    switchTab('tab-console'); engineRunning = true; engineStop = false;
    $("#dmall-status-text").text("Running Campaign..."); $("#con-bots").text(bots.length);

    // 1. STATE CHECK & SCRAPING
    let targets = [];
    if (audience === 'test') {
        let testId = $("#test-user-id").val();
        if(!testId) { engineRunning = false; return alert("Enter Test ID!"); }
        targets = [testId];
        logTerminalOutput(`Running TEST MODE on ID ${targets[0]}`, "info");
    } else {
        // Resume check
        let savedTargets = JSON.parse(localStorage.getItem('nosify_dm_targets'));
        if (savedTargets && savedTargets.length > 0) {
            targets = savedTargets;
            logTerminalOutput(`Resuming campaign. Loaded ${targets.length} pending targets from memory.`, "info");
        } else {
            logTerminalOutput(`Connecting to Discord API... Scraping all members from Server ${serverId}`, "info");
            logTerminalOutput(`WARNING: Bots require 'Server Members Intent' to scrape accurately.`, "err");
            
            let lastId = 0; let fetchLoop = true; let useBot = bots[0].token;
            while(fetchLoop && !engineStop) {
                try {
                    let res = await discordProxy(`https://discord.com/api/v10/guilds/${serverId}/members?limit=1000&after=${lastId}`, 'GET', useBot);
                    if(res.ok) {
                        let members = await res.json();
                        if(members.length === 0) { fetchLoop = false; }
                        else {
                            let validIds = members.filter(m => !m.user.bot).map(m => m.user.id);
                            targets.push(...validIds);
                            lastId = members[members.length - 1].user.id;
                            logTerminalOutput(`Scraped chunk: +${validIds.length} humans (Total: ${targets.length})`, "info");
                            $("#con-scraped").text(targets.length);
                            if(members.length < 1000) fetchLoop = false; // Reached the end
                        }
                    } else {
                        logTerminalOutput(`Discord rejected scraping (Code ${res.status}). Make sure Intents are enabled!`, "err");
                        fetchLoop = false;
                    }
                } catch(e) { logTerminalOutput(`Scrape Network Error. Stopping fetch.`, "err"); fetchLoop = false; }
                await new Promise(r => setTimeout(r, 1000)); // Rate limit protection
            }
            
            // Remove blacklisted people from raw targets
            targets = targets.filter(id => !blacklistDB.includes(id));
            localStorage.setItem('nosify_dm_targets', JSON.stringify(targets));
            logTerminalOutput(`Scraping complete. Final target list: ${targets.length} users.`, "win");
        }
    }

    $("#con-scraped").text(targets.length);
    let total = targets.length; let sentCount = 0; let failCount = 0;
    
    // 2. SENDING DMs (REAL API)
    for(let i=0; i<targets.length; i++) {
        if(engineStop) {
            // Save remaining targets if stopped
            localStorage.setItem('nosify_dm_targets', JSON.stringify(targets.slice(i)));
            break;
        }
        
        let targetId = targets[i];
        let botToken = bots[i % bots.length].token; // Rotate bots
        
        // Step A: Open DM Channel
        let channelRes = await discordProxy('https://discord.com/api/v10/users/@me/channels', 'POST', botToken, { recipient_id: targetId });
        
        if (channelRes.ok) {
            let channelData = await channelRes.json();
            let channelId = channelData.id;
            
            // Format Custom Variables
            let finalPayloadStr = rawEmbedJson.replace(/{userid}/g, targetId).replace(/{usermention}/g, `<@${targetId}>`);
            let finalPayload = JSON.parse(finalPayloadStr);
            
            // Step B: Send Message
            let msgRes = await discordProxy(`https://discord.com/api/v10/channels/${channelId}/messages`, 'POST', botToken, finalPayload);
            
            if (msgRes.ok) {
                sentCount++; logTerminalOutput(`[Bot ${i%bots.length + 1}] ✅ Message Delivered to <@${targetId}>`, "win");
            } else {
                failCount++; logTerminalOutput(`[Bot ${i%bots.length + 1}] ❌ Network Drop (403/Forbidden) to ${targetId}`, "err");
            }
        } else {
            failCount++; logTerminalOutput(`[Bot ${i%bots.length + 1}] ❌ Failed to open DM with ${targetId}`, "err");
        }
        
        // Update Stats UI & Global Database
        $("#con-sent").text(sentCount); $("#con-failed").text(failCount);
        $("#con-progress").css("width", `${((i+1)/total)*100}%`);
        statsDB.sent++; if (!channelRes.ok) statsDB.failed++;
        localStorage.setItem('nosify_dm_stats', JSON.stringify(statsDB)); 
        updateStats();

        // Constantly update the saved target array so if the user closes the tab, it resumes perfectly
        localStorage.setItem('nosify_dm_targets', JSON.stringify(targets.slice(i + 1)));

        await new Promise(r => setTimeout(r, dmDelay)); 
    }
    
    $("#dmall-status-text").text("Sequence Halted.");
    if (!engineStop) {
        logTerminalOutput(`Campaign Sequence Complete. Targets exhausted.`, "win");
        localStorage.removeItem('nosify_dm_targets'); // Wipe memory when completely finished
        
        // 3. AUTO LEAVE SEQUENCE
        if (autoLeave) {
            logTerminalOutput(`Initiating Auto-Leave Protocol...`, "info");
            for (let b = 0; b < bots.length; b++) {
                await discordProxy(`https://discord.com/api/v10/users/@me/guilds/${serverId}`, 'DELETE', bots[b].token);
                logTerminalOutput(`[Bot ${b+1}] 👋 Left server successfully.`, "win");
                await new Promise(r => setTimeout(r, 600)); 
            }
        }
    }
    
    engineRunning = false;
}

function stopDmall() { 
    if(!engineRunning) return;
    engineStop = true; 
    $("#dmall-status-text").text("Interrupt Handler Triggered.");
    logTerminalOutput("EMERGENCY STOP TRIGGERED. Saving progress...", "err"); 
}

// --- FULL ADMIN PANEL HANDLERS ---
async function adminAction(action, payload) {
    await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': adminPass }, body: JSON.stringify({ action, payload }) });
    loadAdminKeys();
}

async function createKey() {
    let customName = $("#adm-custom-name").val().trim();
    let k = customName ? customName : "KEY-" + Math.random().toString(36).substr(2, 6).toUpperCase();
    let time = $("#adm-key-time").val(); let max = $("#adm-key-uses").val();
    let exp = null;
    if (time !== "perm") { let ms = new Date().getTime(); if (time === "1d") exp = ms + (24*3600000); }
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
    db.keys.forEach((k, i) => {
        html += `<tr class="border-b border-gray-800"><td class="py-3 px-2 text-[#6366f1] font-bold">${k.key}</td><td class="py-3 px-2 text-gray-300">${k.time}</td><td class="py-3 px-2 text-green-400 font-mono">${k.left}</td><td class="py-3 px-2 text-gray-500 font-mono text-xs opacity-80 truncate max-w-[80px]">${k.claimedBy || 'Unused'}</td><td class="py-3 px-2 text-right whitespace-nowrap"><button onclick="copyKey('${k.key}')" class="bg-[#27272a] text-white text-[10px] px-3 py-1.5 rounded mr-2">Copy</button><button onclick="deleteKey(${i})" class="text-red-400 font-bold text-sm">✕</button></td></tr>`;
    });
    $("#adm-keys-list").html(html);
}

async function loadAdminSpyData() {
    let res = await fetch('/api/admin?spy=true', { headers: { 'Authorization': adminPass }});
    let data = await res.json(); $("#spy-content").text(JSON.stringify(data, null, 2));
}
    
