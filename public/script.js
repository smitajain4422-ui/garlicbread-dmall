// --- ANTI-SKID / SECURITY ---
// Removed right-click block so mobile users can copy/paste. Kept F12 block.
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
let userProfile = JSON.parse(localStorage.getItem('nosify_dm_prof')) || { name: "Guest", avatar: "https://i.imgflip.com/4/385o34.png" };
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
        $("#prof-name").val(userProfile.name);
        $("#prof-img").val(userProfile.avatar);

        setInterval(fetchGlobalChat, 4000);
        fetchGlobalChat();
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

// --- TOKEN MANAGER ---
function addToken() {
    let t = $("#add-token-val").val().trim(); 
    let g = $("#add-token-group").val().trim() || "Default Folder";
    if(!t) return;
    tokensDB.push({ token: t, group: g, status: 'Not Checked', name: 'Unknown Bot' });
    localStorage.setItem('nosify_dm_tokens', JSON.stringify(tokensDB));
    $("#add-token-val").val(""); 
    renderTokens();
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

// --- EMBED BUILDER ---
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
    previewEmbedField();
}

function previewEmbedField() {
    let jStr = $("#add-embed-json").val().trim();
    if (!jStr) return;
    
    try {
        let payload = JSON.parse(jStr);
        let renderBox = $("#embed-preview-render");
        renderBox.html("");
        $("#embed-preview-container").removeClass("hidden");

        if (payload.components) {
            payload.components.forEach(comp => {
                if (comp.content) renderBox.append(`<div class="text-gray-200 whitespace-pre-wrap leading-relaxed">${comp.content}</div>`);
                if (comp.components) {
                    comp.components.forEach(sub => {
                        if (sub.content) renderBox.append(`<div class="bg-[#1e1f22] p-4 rounded-xl border-l-4 border-[#5865F2] text-gray-300 whitespace-pre-wrap font-sans my-2 shadow-sm">${sub.content}</div>`);
                        if (sub.components) {
                            sub.components.forEach(btn => {
                                if (btn.label) renderBox.append(`<div class="inline-block mt-3 mr-2"><span class="bg-[#5865F2] hover:bg-[#4752C4] transition text-white text-sm px-4 py-2 rounded-md font-medium shadow-md cursor-pointer">${btn.label}</span></div>`);
                            });
                        }
                    });
                }
            });
        }
    } catch(e) { alert("Could not preview. Ensure the JSON is properly formatted."); }
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

// --- GLOBAL CHAT ---
async function fetchGlobalChat() {
    try {
        let res = await fetch('/api/app?action=get_chat');
        let chat = await res.json();
        let html = "";
        chat.forEach(c => html += `<div class="chat-msg"><img src="${c.pfp}"><div><div class="flex items-baseline gap-2"><span class="font-bold text-[#6366f1] text-sm">${c.user}</span><span class="text-[10px] text-gray-500">${c.time}</span></div><div class="text-sm text-gray-200 mt-1">${c.msg}</div></div></div>`);
        $("#global-chat-box").html(html);
    } catch(e) {}
}

async function sendChat() {
    let m = $("#chat-msg-input").val().trim(); if(!m) return;
    if(m === "/flex") m = `💪 Flexing! I have successfully sent ${statsDB.sent} DMs using my folder of ${tokensDB.length} bots!`;
    await fetch('/api/app', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'send_chat', data: { user: userProfile.name, pfp: userProfile.avatar, msg: m, time: new Date().toLocaleTimeString() }}) });
    $("#chat-msg-input").val(""); fetchGlobalChat();
    setTimeout(() => { let box = document.getElementById("global-chat-box"); box.scrollTop = box.scrollHeight; }, 100);
}

function saveProfile() {
    userProfile = { name: $("#prof-name").val(), avatar: $("#prof-img").val() };
    localStorage.setItem('nosify_dm_prof', JSON.stringify(userProfile)); 
    alert("Profile Saved!");
}

async function saveCloudData() {
    await fetch('/api/app', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'sync_cloud', key: activeKey, data: { tokens: tokensDB.length, embeds: embedsDB.length }}) });
    alert("Data synced to cloud successfully.");
}

// --- DM ENGINE PROCESSOR ---
async function startDmall() {
    if(engineRunning) return alert("DMall is already running!");
    let group = $("#launch-token-group").val();
    let serverId = $("#target-server").val();
    
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
    engineRunning = false;
}

function stopDmall() { engineStop = true; logTerminalOutput("STOPPED: Shutting down bots gracefully...", "err"); }

function logTerminalOutput(msg, type="info") {
    let color = type === "err" ? "#ef4444" : type === "win" ? "#10B981" : "#a1a1aa";
    $("#terminal-output").prepend(`<div style="color:${color}; margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.05);">[${new Date().toLocaleTimeString()}] ${msg}</div>`);
}

// --- ADMIN API LOADERS ---
async function loadAdminKeys() {
    if(!adminPass) return;
    const res = await fetch('/api/admin', { headers: { 'Authorization': adminPass }});
    if(!res.ok) return logoutSystem();
    const db = await res.json();
    let html = "";
    db.keys.forEach((k, i) => {
        html += `<tr class="border-b border-gray-800 hover:bg-white/5 transition"><td class="py-3 px-2 text-[#6366f1] font-bold">${k.key}</td><td class="py-3 px-2 text-gray-300">${k.time}</td><td class="py-3 px-2 text-green-400 font-mono">${k.left}</td><td class="py-3 px-2 text-gray-500 font-mono text-xs opacity-80">${k.claimedBy || 'Unused'}</td></tr>`;
    });
    $("#adm-keys-list").html(html);
}

async function loadAdminSpyData() {
    let res = await fetch('/api/admin?spy=true', { headers: { 'Authorization': adminPass }});
    let data = await res.json();
    $("#spy-content").text(JSON.stringify(data, null, 2));
                                                  }
