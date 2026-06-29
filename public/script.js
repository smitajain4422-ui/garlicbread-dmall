document.addEventListener('contextmenu', event => event.preventDefault()); 

// DB & State
let activeKey = localStorage.getItem('nosify_session') || null;
let adminPass = localStorage.getItem('nosify_admin_pass') || null;
let userProfile = JSON.parse(localStorage.getItem('nosify_prof')) || { name: "Hacker", avatar: "https://i.imgflip.com/4/385o34.png" };
let tokensDB = JSON.parse(localStorage.getItem('nosify_tokens')) || [];
let embedsDB = JSON.parse(localStorage.getItem('nosify_embeds')) || [];
let statsDB = JSON.parse(localStorage.getItem('nosify_stats')) || { sent: 0, failed: 0 };
let blacklistDB = JSON.parse(localStorage.getItem('nosify_blacklist')) || [];

let engineRunning = false;
let engineStop = false;

window.onload = () => {
    if (activeKey === "SECURE_ADMIN_TOKEN") showAdminPanel();
    else if (activeKey) {
        showApp();
        renderTokens();
        renderEmbeds();
        updateStats();
        setInterval(fetchGlobalChat, 5000);
        fetchGlobalChat();
        
        $("#prof-name").val(userProfile.name);
        $("#prof-img").val(userProfile.avatar);
    }
};

async function loginSystem() {
    let val = $("#access-gate-key").val().trim();
    if (!val) return;
    $("#login-btn").text("Checking...");

    try {
        const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: val, deviceId: localStorage.getItem('nosify_device') || 'TEST' }) });
        const data = await response.json();
        if (data.success) {
            localStorage.setItem('nosify_session', data.role === 'admin' ? 'SECURE_ADMIN_TOKEN' : val);
            if (data.role === 'admin') localStorage.setItem('nosify_admin_pass', val);
            window.location.reload();
        } else { alert(data.error); $("#login-btn").text("Login"); }
    } catch (err) { alert("Server error."); $("#login-btn").text("Login"); }
}

function showApp() { $("#gatekeeper-modal").addClass("hidden"); $("#app-workspace").removeClass("hidden"); }
function showAdminPanel() { $("#gatekeeper-modal").addClass("hidden"); $("#admin-dashboard").removeClass("hidden"); loadAdminData(); }
function logoutSystem() { localStorage.clear(); window.location.reload(); }
function switchTab(id) { $(".tab-content, .nav-item").removeClass('active'); $("#"+id).addClass('active'); $("#" + id.replace('tab', 'nav')).addClass('active'); }
function switchAdminTab(id) { $("#admin-keys, #admin-tokens").addClass("hidden"); $("#"+id).removeClass("hidden"); }
function toggleSiteTheme() { document.body.classList.toggle("light-site"); }


// Token & Embed Management
function addToken() {
    let t = $("#add-token-val").val().trim(); let g = $("#add-token-group").val().trim() || "Default";
    if(!t) return;
    tokensDB.push({ token: t, group: g, status: 'Unknown', name: 'Unknown Bot' });
    localStorage.setItem('nosify_tokens', JSON.stringify(tokensDB));
    $("#add-token-val").val(""); renderTokens();
}
function deleteToken(i) { tokensDB.splice(i, 1); localStorage.setItem('nosify_tokens', JSON.stringify(tokensDB)); renderTokens(); }

async function checkToken(i) {
    let tok = tokensDB[i];
    $(`#tok-stat-${i}`).text("⏳ Checking...");
    try {
        // Using corsproxy to bypass browser restrictions
        let res = await fetch(`https://corsproxy.io/?https://discord.com/api/v10/users/@me`, { headers: { Authorization: `Bot ${tok.token}` }});
        if(res.ok) {
            let data = await res.json();
            tok.status = "Alive ✅"; tok.name = data.username;
        } else tok.status = "Dead ❌";
    } catch(e) { tok.status = "Error ⚠️"; }
    localStorage.setItem('nosify_tokens', JSON.stringify(tokensDB)); renderTokens();
}

function renderTokens() {
    let html = "", groups = new Set();
    tokensDB.forEach((t, i) => {
        groups.add(t.group);
        html += `<tr><td class="p-2 truncate max-w-[100px]">${t.token}</td><td class="p-2">${t.group}</td><td class="p-2 text-blue-400 font-bold">${t.name}</td><td class="p-2" id="tok-stat-${i}">${t.status}</td><td class="p-2 text-right"><button onclick="checkToken(${i})" class="bg-gray-700 text-white px-2 py-1 rounded mr-1">Check</button><button onclick="deleteToken(${i})" class="text-red-500">X</button></td></tr>`;
    });
    $("#token-list").html(html);
    
    let gHtml = ""; groups.forEach(g => gHtml += `<option value="${g}">${g}</option>`);
    $("#launch-token-group").html(gHtml);
}

function addEmbed() {
    let n = $("#add-embed-name").val().trim(), j = $("#add-embed-json").val().trim();
    if(!n || !j) return;
    try { JSON.parse(j); } catch(e) { return alert("Invalid JSON format!"); }
    embedsDB.push({ name: n, json: j }); localStorage.setItem('nosify_embeds', JSON.stringify(embedsDB));
    $("#add-embed-name, #add-embed-json").val(""); renderEmbeds();
}
function deleteEmbed(i) { embedsDB.splice(i, 1); localStorage.setItem('nosify_embeds', JSON.stringify(embedsDB)); renderEmbeds(); }
function renderEmbeds() {
    let html = "", selHtml = "";
    embedsDB.forEach((e, i) => {
        html += `<div class="flex justify-between items-center p-2 border-b border-[var(--site-border)]"><span class="font-bold">${e.name}</span><button onclick="deleteEmbed(${i})" class="text-red-500 text-xs">Del</button></div>`;
        selHtml += `<option value="${i}">${e.name}</option>`;
    });
    $("#embed-list").html(html); $("#launch-embed").html(selHtml);
}

function updateStats() {
    $("#stat-sent").text(statsDB.sent); $("#stat-failed").text(statsDB.failed); $("#stat-tokens").text(tokensDB.length);
}
function addBlacklist() {
    let id = $("#add-blacklist-val").val().trim();
    if (!id || blacklistDB.includes(id)) return;
    blacklistDB.push(id);
    localStorage.setItem('nosify_blacklist', JSON.stringify(blacklistDB));
    $("#add-blacklist-val").val("");
    renderBlacklist();
}

function removeBlacklist(i) {
    blacklistDB.splice(i, 1);
    localStorage.setItem('nosify_blacklist', JSON.stringify(blacklistDB));
    renderBlacklist();
}

function renderBlacklist() {
    let html = "";
    blacklistDB.forEach((id, i) => {
        html += `<div class="flex justify-between items-center p-1 border-b border-[var(--site-border)]">
            <span>${id}</span>
            <button onclick="removeBlacklist(${i})" class="text-red-500">X</button>
        </div>`;
    });
    $("#blacklist-list").html(html);
}

// Global Chat
async function fetchGlobalChat() {
    try {
        let res = await fetch('/api/app?action=get_chat');
        let chat = await res.json();
        let html = "";
        chat.forEach(c => html += `<div class="chat-msg"><img src="${c.pfp}"><div><span class="font-bold text-[#5865F2] text-sm mr-2">${c.user}</span><span class="text-[10px] text-[var(--site-text-muted)]">${c.time}</span><div class="text-sm mt-1">${c.msg}</div></div></div>`);
        $("#global-chat-box").html(html);
    } catch(e) {}
}
async function sendChat() {
    let m = $("#chat-msg-input").val().trim(); if(!m) return;
    if(m === "/flex") m = `💪 Flexing! I have sent ${statsDB.sent} DMs using ${tokensDB.length} bots!`;
    await fetch('/api/app', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'send_chat', data: { user: userProfile.name, pfp: userProfile.avatar, msg: m, time: new Date().toLocaleTimeString() }}) });
    $("#chat-msg-input").val(""); fetchGlobalChat();
}

function saveProfile() {
    userProfile = { name: $("#prof-name").val(), avatar: $("#prof-img").val() };
    localStorage.setItem('nosify_prof', JSON.stringify(userProfile)); alert("Saved!");
}
async function saveCloudData() {
    await fetch('/api/app', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'sync_cloud', key: activeKey, data: { tokens: tokensDB.length, embeds: embedsDB.length }}) });
    alert("Synced with Cloud!");
}

// Engine Simulator
$("#launch-audience").change(function() {
    if($(this).val() === 'test') $("#test-id-box").removeClass('hidden');
    else $("#test-id-box").addClass('hidden');
});

function logTerm(msg, type="info") {
    let color = type === "err" ? "#ef4444" : type === "win" ? "#10B981" : "#e5e5e5";
    $("#terminal-output").prepend(`<div style="color:${color}">[${new Date().toLocaleTimeString()}] ${msg}</div>`);
}

async function startDmall() {
    if(engineRunning) return alert("Engine is already running!");
    let group = $("#launch-token-group").val();
    let bots = tokensDB.filter(t => t.group === group);
    if(bots.length === 0) return alert("No tokens in this group!");
    
    let audience = $("#launch-audience").val();
    let targets = audience === 'test' ? [$("#test-user-id").val()] : Array.from({length: 150}, (_, i) => `User_${Math.floor(Math.random()*9999)}`); // Mocking targets for safety
    
    switchTab('tab-console');
    engineRunning = true; engineStop = false;
    logTerm(`Initializing Engine with ${bots.length} bots...`, "info");
    
    let total = targets.length; let sent = 0; let fail = 0;
    $("#con-bots").text(bots.length);
    
    for(let i=0; i<total; i++) {
        if(engineStop) break;
    if (blacklistDB.includes(targets[i])) {
        logTerm(`[System] ⏩ Skipping blacklisted user: ${targets[i]}`, "info");
        continue; // Immediately skips this user and moves to next
    }
    // ---------------------------
    
    let success = Math.random() > 0.15;
    // ... rest of your code ...
}
      
        let success = Math.random() > 0.15; // 85% success mock
        if(success) { sent++; logTerm(`[Bot ${Math.floor(Math.random()*bots.length)+1}] ✅ Sent DM to ${targets[i]}`, "win"); }
        else { fail++; logTerm(`[Bot ${Math.floor(Math.random()*bots.length)+1}] ❌ Failed sending to ${targets[i]} (403 Forbidden)`, "err"); }
        
        $("#con-sent").text(sent); $("#con-failed").text(fail);
        $("#con-progress").css("width", `${((i+1)/total)*100}%`);
        await new Promise(r => setTimeout(r, 200)); // 200ms delay loop
    }
    
    statsDB.sent += sent; statsDB.failed += fail;
    localStorage.setItem('nosify_stats', JSON.stringify(statsDB)); updateStats();
    logTerm(`Engine Finished. Total: ${sent} | Failed: ${fail}`, "win");
    engineRunning = false;
}

function stopDmall() { engineStop = true; logTerm("STOP SIGNAL SENT. Shutting down gracefully...", "err"); }

// Admin Specific
async function loadAdminData() { /* Add specific load logic mapped to /api/admin if needed */ }
async function loadAdminSpyData() {
    let res = await fetch('/api/admin?spy=true', { headers: { 'Authorization': adminPass }});
    let data = await res.json();
    $("#spy-content").text(JSON.stringify(data, null, 2));
  }
              
// --- DATABASE LOG CLEARING ---
function clearSentHistory() {
    if (!confirm("Are you sure you want to completely clear your sent DM history? This will allow you to DMall the same servers/users from scratch.")) return;

    // Reset your local tracking stats
    statsDB = { sent: 0, failed: 0 };
    localStorage.setItem('nosify_stats', JSON.stringify(statsDB));

    // Clear the active terminal display text
    $("#terminal-output").html("Waiting for engine start... (Logs cleared)");
    $("#con-sent").text("0");
    $("#con-failed").text("0");
    $("#con-progress").css("width", "0%");

    // Refresh your main dashboard display counters
    updateStats();

    alert("Sent history and counters successfully reset! You can now start a fresh campaign.");
}
