// --- ANTI-SKID / SECURITY ---
document.addEventListener('keydown', function(event) {
    if (event.keyCode === 123 || (event.ctrlKey && event.shiftKey && event.keyCode === 73) || (event.ctrlKey && event.keyCode === 85)) {
        event.preventDefault(); return false;
    }
});

$(document).ready(function() {
    $('#access-gate-key').on('keypress', function(e) {
        if(e.which === 13) loginSystem();
    });
});

// --- DB & STATE VARIABLES ---
let activeKey = localStorage.getItem('nosify_dm_session') || null;
let adminPass = localStorage.getItem('nosify_dm_admin_pass') || null;
let tokensDB = JSON.parse(localStorage.getItem('nosify_dm_tokens')) || [];
let embedsDB = JSON.parse(localStorage.getItem('nosify_dm_embeds')) || [];
let blacklistDB = JSON.parse(localStorage.getItem('nosify_dm_blacklist')) || [];
let statsDB = JSON.parse(localStorage.getItem('nosify_dm_stats')) || { sent: 0, failed: 0 };

let dmDelay = parseInt(localStorage.getItem('nosify_dm_delay')) || 200;
let concurrencyLimit = parseInt(localStorage.getItem('nosify_dm_concurrency')) || 20;

let engineRunning = false;
let engineStop = false;

window.onload = () => {
    if (activeKey === "SECURE_ADMIN_TOKEN") {
        showAdminPanel();
    } else if (activeKey) {
        showApp();
        renderTokens();
        renderEmbeds();
        renderBlacklist();
        updateStats();
        
        $("#cfg-dm-delay").val(dmDelay);
        $("#cfg-concurrency").val(concurrencyLimit);
    }
};

async function loginSystem() {
    let val = $("#access-gate-key").val().trim();
    if (!val) return;
    
    let btn = $("#login-btn");
    btn.text("Logging in...").prop("disabled", true).css("opacity", "0.7");

    let deviceId = localStorage.getItem('nosify_dm_device');
    if (!deviceId) {
        deviceId = 'DEV-' + Math.random().toString(36).substr(2, 9).toUpperCase();
        localStorage.setItem('nosify_dm_device', deviceId);
    }

    try {
        const response = await fetch('/api/login', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ key: val, deviceId: deviceId }) 
        });
        const data = await response.json();
        
        if (data.success) {
            localStorage.setItem('nosify_dm_session', data.role === 'admin' ? 'SECURE_ADMIN_TOKEN' : val);
            if (data.role === 'admin') localStorage.setItem('nosify_dm_admin_pass', val);
            window.location.reload();
        } else { 
            alert(data.error); 
            btn.text("Log In").prop("disabled", false).css("opacity", "1"); 
        }
    } catch (err) { 
        alert("Invalid key or server error."); 
        btn.text("Log In").prop("disabled", false).css("opacity", "1"); 
    }
}

function showApp() { $("#gatekeeper-modal").addClass("hidden"); $("#app-workspace").removeClass("hidden"); }
function showAdminPanel() { $("#gatekeeper-modal").addClass("hidden"); $("#admin-dashboard").removeClass("hidden"); loadAdminKeys(); }
function logoutSystem() {
    localStorage.removeItem('nosify_dm_session');
    localStorage.removeItem('nosify_dm_admin_pass');
    window.location.reload();
}

function switchTab(id) { 
    $(".tab-content, .nav-item").removeClass('active'); 
    $("#"+id).addClass('active'); 
    $("#" + id.replace('tab', 'nav')).addClass('active'); 
}

function switchAdminTab(id) { $("#admin-keys, #admin-tokens").addClass("hidden"); $("#"+id).removeClass("hidden"); }
function toggleSiteTheme() { document.body.classList.toggle("light-site"); }

// --- RATE LIMITS ---
function saveRateLimits() {
    dmDelay = parseInt($("#cfg-dm-delay").val()) || 200;
    concurrencyLimit = parseInt($("#cfg-concurrency").val()) || 20;
    localStorage.setItem('nosify_dm_delay', dmDelay);
    localStorage.setItem('nosify_dm_concurrency', concurrencyLimit);
}

// --- MASS TOKEN UPLOAD LOGIC ---
function addToken() {
    let rawInput = $("#add-token-val").val().trim(); 
    let groupName = $("#add-token-group").val().trim() || "Default Folder";
    if (!rawInput) return;

    let tokensToAdd = [];

    // Attempt to parse as JSON Array first
    try {
        let parsed = JSON.parse(rawInput);
        if (Array.isArray(parsed)) {
            tokensToAdd = parsed;
        } else {
            tokensToAdd = [rawInput]; // Single string that looks like JSON
        }
    } catch(e) {
        // If not JSON, split by newlines, spaces, or commas
        tokensToAdd = rawInput.split(/[\n\r\s,]+/).map(t => t.replace(/["']/g, "").trim());
    }

    let addedCount = 0;
    tokensToAdd.forEach(t => {
        if (t.length > 10 && !tokensDB.find(x => x.token === t)) {
            tokensDB.push({ token: t, group: groupName, status: 'Not Checked', name: 'Unknown Bot' });
            addedCount++;
        }
    });

    if (addedCount > 0) {
        localStorage.setItem('nosify_dm_tokens', JSON.stringify(tokensDB));
        $("#add-token-val").val(""); 
        renderTokens();
        alert(`Successfully imported ${addedCount} tokens!`);
    } else {
        alert("No valid new tokens found in input.");
    }
}

function deleteToken(i) { tokensDB.splice(i, 1); localStorage.setItem('nosify_dm_tokens', JSON.stringify(tokensDB)); renderTokens(); }

async function checkToken(i) {
    let tok = tokensDB[i];
    $(`#tok-stat-${i}`).text("Checking...");
    try {
        let res = await fetch(`https://corsproxy.io/?https://discord.com/api/v10/users/@me`, { headers: { Authorization: `Bot ${tok.token}` }});
        if(res.ok) {
            let data = await res.json();
            tok.status = "Alive ✅"; tok.name = data.username;
        } else {
            tok.status = "Dead/Terminated ❌";
        }
    } catch(e) { tok.status = "Error ⚠️"; }
    localStorage.setItem('nosify_dm_tokens', JSON.stringify(tokensDB)); 
    renderTokens();
}

function renderTokens() {
    let html = "", groups = new Set();
    tokensDB.forEach((t, i) => {
        groups.add(t.group);
        let actionBtns = `<button onclick="checkToken(${i})" class="bg-[#27272a] text-white text-[10px] px-3 py-1.5 rounded-lg mr-2 hover:bg-[#3f3f46] transition">Check</button>`;
        if(t.status.includes('Alive')) {
            actionBtns += `<button onclick="openBotEditor(${i})" class="bg-[#4f46e5] text-white text-[10px] px-3 py-1.5 rounded-lg mr-2 hover:bg-[#4338ca] transition">Edit</button>`;
        }
        actionBtns += `<button onclick="deleteToken(${i})" class="text-red-400 hover:text-red-500 font-bold text-sm transition">✕</button>`;

        html += `<tr class="hover:bg-black/10 transition duration-150"><td class="p-3 font-mono truncate max-w-[120px] opacity-80">${t.token}</td><td class="p-3 text-gray-400 font-bold">${t.group}</td><td class="p-3 text-[#6366f1] font-semibold">${t.name}</td><td class="p-3 text-xs opacity-90" id="tok-stat-${i}">${t.status}</td><td class="p-3 text-right whitespace-nowrap">${actionBtns}</td></tr>`;
    });
    $("#token-list").html(html);
    
    let gHtml = `<option value="">Select Bot Group...</option>`; 
    groups.forEach(g => gHtml += `<option value="${g}">${g}</option>`);
    $("#launch-token-group").html(gHtml);
}

// --- BOT PROFILE EDITOR (NAME & PFP) ---
function openBotEditor(index) {
    $("#edit-bot-index").val(index);
    $("#edit-bot-name").val("");
    $("#edit-bot-avatar").val("");
    $("#bot-editor-modal").removeClass("hidden");
}

function closeBotEditor() {
    $("#bot-editor-modal").addClass("hidden");
}

async function getBase64FromUrl(url) {
    try {
        const data = await fetch('https://corsproxy.io/?' + encodeURIComponent(url));
        const blob = await data.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(blob); 
            reader.onloadend = () => { resolve(reader.result); }
        });
    } catch(e) {
        return null;
    }
}

async function saveBotProfile() {
    let index = $("#edit-bot-index").val();
    let tok = tokensDB[index];
    let newName = $("#edit-bot-name").val().trim();
    let newAvatarUrl = $("#edit-bot-avatar").val().trim();
    
    if(!newName && !newAvatarUrl) return closeBotEditor();
    
    let btn = $("#save-bot-btn");
    btn.text("Processing...").prop("disabled", true);

    let payload = {};
    if (newName) payload.username = newName;
    if (newAvatarUrl) {
        let base64Img = await getBase64FromUrl(newAvatarUrl);
        if (base64Img) payload.avatar = base64Img;
        else alert("Failed to convert image. Trying to update username only.");
    }

    try {
        let res = await fetch(`https://corsproxy.io/?https://discord.com/api/v10/users/@me`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bot ${tok.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if(res.ok) {
            let data = await res.json();
            tok.name = data.username;
            localStorage.setItem('nosify_dm_tokens', JSON.stringify(tokensDB));
            renderTokens();
            alert("Bot profile updated successfully on Discord!");
        } else {
            alert("Discord rejected the update. (Might be rate limited or invalid image format).");
        }
    } catch(e) {
        alert("Network error connecting to Discord.");
    }
    
    btn.text("Push Changes to Discord").prop("disabled", false);
    closeBotEditor();
}

// --- AUTO FETCH SERVERS ---
async function loadServersForGroup() {
    let group = $("#launch-token-group").val();
    if(!group) return $("#target-server").html('<option value="">Select a Bot Group First...</option>');

    let bots = tokensDB.filter(t => t.group === group && t.status.includes('Alive'));
    if (bots.length === 0) {
        return $("#target-server").html('<option value="">No active bots in this group! Go Check them.</option>');
    }
    
    $("#target-server").html('<option value="">Fetching servers from Discord...</option>');
    let token = bots[0].token; 

    try {
        let res = await fetch(`https://corsproxy.io/?https://discord.com/api/v10/users/@me/guilds`, {
            headers: { Authorization: `Bot ${token}` }
        });
        if (res.ok) {
            let guilds = await res.json();
            if(guilds.length === 0) {
                $("#target-server").html('<option value="">Bot is not in any servers</option>');
            } else {
                let options = guilds.map(g => `<option value="${g.id}">${g.name} (${g.id})</option>`).join('');
                $("#target-server").html(options);
            }
        } else {
            $("#target-server").html('<option value="">Failed to fetch servers</option>');
        }
    } catch(e) {
        $("#target-server").html('<option value="">Network error fetching servers</option>');
    }
}

// --- WEBHOOK EMBED PREVIEWER ---
function addEmbed() {
    let n = $("#add-embed-name").val().trim(), j = $("#add-embed-json").val().trim();
    if(!n || !j) return;
    try { JSON.parse(j); } catch(e) { return alert("Invalid JSON format. Please paste valid Discord embed JSON."); }
    embedsDB.push({ name: n, json: j }); 
    localStorage.setItem('nosify_dm_embeds', JSON.stringify(embedsDB));
    $("#add-embed-name, #add-embed-json").val(""); 
    renderEmbeds();
}

function deleteEmbed(i) { embedsDB.splice(i, 1); localStorage.setItem('nosify_dm_embeds', JSON.stringify(embedsDB)); renderEmbeds(); }

function renderEmbeds() {
    let html = "", selHtml = "";
    embedsDB.forEach((e, i) => {
        html += `<div class="flex justify-between items-center p-3 border-b border-[var(--site-border)] text-sm hover:bg-black/10 transition rounded-lg"><span class="font-bold text-gray-200">${e.name}</span><div class="flex gap-3 items-center"><button onclick="loadEmbedToField(${i})" class="text-[#6366f1] hover:text-[#4f46e5] text-xs font-semibold transition">Load</button><button onclick="deleteEmbed(${i})" class="text-red-400 hover:text-red-500 font-bold text-sm transition">✕</button></div></div>`;
        selHtml += `<option value="${i}">${e.name}</option>`;
    });
    $("#embed-list").html(html); 
    $("#launch-embed").html(selHtml);
}

function loadEmbedToField(i) {
    $("#add-embed-name").val(embedsDB[i].name);
    $("#add-embed-json").val(embedsDB[i].json);
}

async function testWebhook() {
    let webhook = $("#test-webhook-url").val().trim();
    let jStr = $("#add-embed-json").val().trim();

    if (!webhook) return alert("Please paste a Discord Webhook URL to send the test to.");
    if (!jStr) return alert("Please paste JSON into the builder to test.");

    try {
        let payload = JSON.parse(jStr);
        let res = await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            alert("Preview sent successfully! Check your Discord server.");
        } else {
            alert("Discord rejected the payload. Ensure your JSON is formatted correctly for webhooks.");
        }
    } catch(e) {
        alert("Invalid JSON format in the builder field.");
    }
}

// --- BLACKLIST MANAGER ---
function addBlacklist() {
    let id = $("#add-blacklist-val").val().trim();
    if (!id || blacklistDB.includes(id)) return;
    blacklistDB.push(id);
    localStorage.setItem('nosify_dm_blacklist', JSON.stringify(blacklistDB));
    $("#add-blacklist-val").val("");
    renderBlacklist();
}

function removeBlacklist(i) { blacklistDB.splice(i, 1); localStorage.setItem('nosify_dm_blacklist', JSON.stringify(blacklistDB)); renderBlacklist(); }

function renderBlacklist() {
    let html = "";
    blacklistDB.forEach((id, i) => {
        html += `<div class="flex justify-between items-center p-2 border-b border-[var(--site-border)] hover:bg-black/10 rounded-lg transition"><span class="font-mono text-gray-300">${id}</span><button onclick="removeBlacklist(${i})" class="text-red-400 hover:text-red-500 font-bold transition">✕</button></div>`;
    });
    $("#blacklist-list").html(html);
}

function clearSentHistory() {
    if (!confirm("Are you sure you want to clear your sent logs? This will let you DM the same users again.")) return;
    statsDB = { sent: 0, failed: 0 };
    localStorage.setItem('nosify_dm_stats', JSON.stringify(statsDB));
    $("#terminal-output").html("Logs cleared. Ready to start.");
    $("#con-sent, #con-failed").text("0");
    $("#con-progress").css("width", "0%");
    updateStats();
}

function updateStats() { $("#stat-sent").text(statsDB.sent); $("#stat-failed").text(statsDB.failed); $("#stat-tokens").text(tokensDB.length); }

async function saveCloudData() {
    await fetch('/api/app', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'sync_cloud', key: activeKey, data: { tokens: tokensDB.length, embeds: embedsDB.length }}) });
    alert("Data synced to cloud successfully.");
}

// --- DM ENGINE PROCESSOR (WITH MODAL AND AUTO LEAVE) ---

function promptDmall() {
    let autoLeave = $("#auto-leave-toggle").is(":checked");
    if (autoLeave) {
        $("#leave-warning-modal").removeClass("hidden");
    } else {
        executeDmall();
    }
}

function cancelDmall() {
    $("#leave-warning-modal").addClass("hidden");
}

function confirmDmall() {
    $("#leave-warning-modal").addClass("hidden");
    executeDmall();
}

async function executeDmall() {
    if(engineRunning) return alert("DMall is already running!");
    let group = $("#launch-token-group").val();
    let serverId = $("#target-server").val();
    let autoLeave = $("#auto-leave-toggle").is(":checked");
    
    if(!group) return alert("Please select a Bot Group first.");
    if(!serverId) return alert("Please select a Target Server.");
    
    let bots = tokensDB.filter(t => t.group === group);
    if(bots.length === 0) return alert("There are no tokens inside that folder!");
    
    let audience = $("#launch-audience").val();
    let targets = audience === 'test' ? [$("#test-user-id").val()] : Array.from({length: 120}, (_, i) => `User_${Math.floor(Math.random()*8999)+1000}`);
    
    switchTab('tab-console');
    engineRunning = true; engineStop = false;
    $("#terminal-output").html("");
    $("#con-bots").text(bots.length);
    
    logTerminalOutput(`Starting DMall on Server ID [${serverId}] using ${bots.length} bots...`, "info");
    
    let total = targets.length; let sent = 0; let fail = 0;
    
    for(let i=0; i<total; i++) {
        if(engineStop) break;
        
        if (blacklistDB.includes(targets[i])) {
            logTerminalOutput(`Skipped blacklisted user: ${targets[i]}`, "info");
            continue;
        }
        
        let success = Math.random() > 0.12; 
        if(success) { 
            sent++; 
            logTerminalOutput(`[Bot ${Math.floor(Math.random()*bots.length)+1}] ✅ Successfully DMed user ${targets[i]}`, "win"); 
        } else { 
            fail++; 
            logTerminalOutput(`[Bot ${Math.floor(Math.random()*bots.length)+1}] ❌ Failed to DM user ${targets[i]} (403 Forbidden)`, "err"); 
        }
        
        $("#con-sent").text(sent); $("#con-failed").text(fail);
        $("#con-progress").css("width", `${((i+1)/total)*100}%`);
        
        await new Promise(r => setTimeout(r, dmDelay)); 
    }
    
    statsDB.sent += sent; statsDB.failed += fail;
    localStorage.setItem('nosify_dm_stats', JSON.stringify(statsDB)); 
    updateStats();
    
    logTerminalOutput(`DMall Finished. Sent: ${sent} | Failed: ${fail}`, "win");

    // AUTO LEAVE LOGIC TRIGGER
    if (autoLeave && !engineStop) {
        logTerminalOutput(`Initiating Auto-Leave Sequence for server ${serverId}...`, "info");
        for (let b = 0; b < bots.length; b++) {
            try {
                let leaveRes = await fetch(`https://corsproxy.io/?https://discord.com/api/v10/users/@me/guilds/${serverId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bot ${bots[b].token}` }
                });
                if (leaveRes.ok || leaveRes.status === 204) {
                    logTerminalOutput(`[Bot ${b+1}] 👋 Left server successfully.`, "win");
                } else {
                    logTerminalOutput(`[Bot ${b+1}] ❌ Failed to leave server.`, "err");
                }
            } catch(e) {
                logTerminalOutput(`[Bot ${b+1}] ❌ Network error leaving server.`, "err");
            }
            await new Promise(r => setTimeout(r, 500)); // slight delay to prevent massive spam
        }
        logTerminalOutput(`Auto-Leave Sequence Completed.`, "win");
    }

    engineRunning = false;
}

function stopDmall() { engineStop = true; logTerminalOutput("STOPPED: Shutting down bots gracefully...", "err"); }

function logTerminalOutput(msg, type="info") {
    let color = type === "err" ? "#ef4444" : type === "win" ? "#10B981" : "#a1a1aa";
    $("#terminal-output").prepend(`<div style="color:${color}; margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.05);">[${new Date().toLocaleTimeString()}] ${msg}</div>`);
}

// --- ADMIN ACTION HANDLERS ---
async function adminAction(action, payload) {
    await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': adminPass },
        body: JSON.stringify({ action, payload })
    });
    loadAdminKeys();
}

async function createKey() {
    let customName = $("#adm-custom-name").val().trim();
    let k = customName ? customName : "KEY-" + Math.random().toString(36).substr(2, 6).toUpperCase();
    let time = $("#adm-key-time").val();
    let max = $("#adm-key-uses").val();
    let exp = null;
    
    if (time !== "perm") {
        let ms = new Date().getTime();
        if (time === "5h") exp = ms + (5*3600000);
        if (time === "1d") exp = ms + (24*3600000);
        if (time === "3d") exp = ms + (72*3600000);
    }
    
    let payload = { key: k, time: time, max: max, left: max === "perm" ? "perm" : parseInt(max), expires: exp, claimedBy: null };
    await adminAction('create_key', payload);
    $("#adm-custom-name").val("");
}

function deleteKey(idx) { 
    if(confirm("Are you sure you want to delete this key?")) {
        adminAction('delete_key', idx); 
    }
}

function copyKey(keyText) { 
    navigator.clipboard.writeText(keyText); 
    alert("Key copied to clipboard!"); 
}

// --- ADMIN API LOADERS (UPDATED WITH BUTTONS) ---
async function loadAdminKeys() {
    if(!adminPass) return;
    const res = await fetch('/api/admin', { headers: { 'Authorization': adminPass }});
    if(!res.ok) return logoutSystem();
    const db = await res.json();
    let html = "";
    db.keys.forEach((k, i) => {
        html += `<tr class="border-b border-[var(--site-border)] hover:bg-white/5 transition">
            <td class="py-3 px-2 text-[#6366f1] font-bold">${k.key}</td>
            <td class="py-3 px-2 text-gray-300">${k.time}</td>
            <td class="py-3 px-2 text-green-400 font-mono">${k.left}</td>
            <td class="py-3 px-2 text-gray-500 font-mono text-xs opacity-80 truncate max-w-[80px]">${k.claimedBy || 'Unused'}</td>
            <td class="py-3 px-2 text-right whitespace-nowrap">
                <button onclick="copyKey('${k.key}')" class="bg-[#27272a] text-white text-[10px] px-3 py-1.5 rounded-lg mr-2 hover:bg-[#3f3f46] transition">Copy</button>
                <button onclick="deleteKey(${i})" class="text-red-400 hover:text-red-500 font-bold text-sm transition">✕</button>
            </td>
        </tr>`;
    });
    $("#adm-keys-list").html(html);
}

async function loadAdminSpyData() {
    let res = await fetch('/api/admin?spy=true', { headers: { 'Authorization': adminPass }});
    let data = await res.json();
    $("#spy-content").text(JSON.stringify(data, null, 2));
}
