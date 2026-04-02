// ==UserScript==
// @name         Video Control Panel PRO (Optimized)
// @namespace    http://tampermonkey.net/
// @version      15.2.1
// @updateURL    https://cdn.jsdelivr.net/gh/thatonevietnamese/control-panel-lite@refs/heads/main/Video%20Control%20Panel%20PRO%20(Optimized).js
// @downloadURL  https://cdn.jsdelivr.net/gh/thatonevietnamese/control-panel-lite@refs/heads/main/Video%20Control%20Panel%20PRO%20(Optimized).js
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @description  new converter liink
// ==/UserScript==

(function () {
'use strict';

// ===== SETTINGS =====
const settings = GM_getValue("settings", {
    speed: 1,
    volume: 1,
    color: "#2b5797",
    wallpaper: "",
    autoShow: true,
    autoVideo: false,
    posX: 60,
    posY: 60,
    hotkeys: {},
    theme: "auto", // light, dark, auto
    opacity: 1.0,
    compactMode: false,
    lastUpdateCheck: 0,
    updateAvailable: false
});

// ===== UPDATE CHECKING =====
const CURRENT_VERSION = "15.1";
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const UPDATE_URL = "https://cdn.jsdelivr.net/gh/thatonevietnamese/control-panel-lite@refs/heads/main/Video%20Control%20Panel%20PRO%20(Optimized).js";

function checkForUpdates(){
    const now = Date.now();
    // Chỉ check update mỗi 24 giờ
    if(now - settings.lastUpdateCheck < UPDATE_CHECK_INTERVAL){
        return;
    }
    
    try {
        GM_xmlhttpRequest({
            method: "GET",
            url: UPDATE_URL,
            onload: function(response) {
                if(response.status === 200){
                    const match = response.responseText.match(/@version\s+([\d.]+)/);
                    if(match && match[1]){
                        const remoteVersion = match[1];
                        if(remoteVersion !== CURRENT_VERSION){
                            settings.updateAvailable = true;
                            console.log("Update available:", remoteVersion);
                            // Hiển thị thông báo update
                            showUpdateNotification(remoteVersion);
                        } else {
                            settings.updateAvailable = false;
                        }
                        settings.lastUpdateCheck = now;
                        GM_setValue("settings", settings);
                    }
                }
            },
            onerror: function(error) {
                console.warn("Update check failed:", error);
            }
        });
    } catch(e) {
        console.warn("Update check not available:", e);
    }
}

function showUpdateNotification(newVersion){
    // Tạo notification element
    const notification = document.createElement("div");
    notification.id = "update-notification";
    notification.innerHTML = `
        <div style="position:fixed; bottom:20px; right:20px; background:#4CAF50; color:white; padding:12px 20px; border-radius:8px; z-index:10001; box-shadow:0 4px 12px rgba(0,0,0,0.3); font-family:Tahoma; font-size:12px; animation:slideIn 0.3s ease;">
            🆕 Update available: v${newVersion}
            <button onclick="window.open('${UPDATE_URL}', '_blank'); this.parentElement.remove();" style="margin-left:10px; background:white; color:#4CAF50; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px;">Update</button>
            <button onclick="this.parentElement.remove();" style="margin-left:5px; background:transparent; color:white; border:1px solid white; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px;">Later</button>
        </div>
    `;
    document.body.appendChild(notification);
    
    // Tự động remove sau 10 giây
    setTimeout(() => {
        if(notification.parentElement){
            notification.remove();
        }
    }, 10000);
}

// ===== STATE =====
let capturingKey = null;
let isDragging = false;
let isLocked = false;
let offsetX = 0, offsetY = 0;
let lastMouseX = 100, lastMouseY = 100;
let lastVideo = null;
let lastApplied = {};
let raf = null;
let observer = null;
let isApplying = false; // FIX: Flag để prevent multiple simultaneous applyVideo calls

// ===== AUDIO BOOST =====
// Cache audio contexts và gain nodes cho từng video
const audioContexts = new WeakMap();

// FIX: Cleanup audio context khi video bị remove
function cleanupAudioContext(video){
    if(audioContexts.has(video)){
        const audioData = audioContexts.get(video);
        try {
            if(audioData.ctx && audioData.ctx.state !== 'closed'){
                audioData.ctx.close();
            }
        } catch(e) {
            console.warn("Error closing AudioContext:", e);
        }
        audioContexts.delete(video);
        // FIX: Thêm logging để debug
        console.log("Audio context cleaned up for video");
    }
}

function getOrCreateGainNode(video){
    if(audioContexts.has(video)){
        const audioData = audioContexts.get(video);
        // FIX: Resume AudioContext nếu bị suspended
        if(audioData.ctx.state === 'suspended'){
            audioData.ctx.resume().catch(e => {
                console.warn("Failed to resume AudioContext:", e);
            });
        }
        return audioData;
    }
    
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(video);
        const gainNode = audioCtx.createGain();
        
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        const audioData = { ctx: audioCtx, gain: gainNode };
        audioContexts.set(video, audioData);
        
        // FIX: Resume AudioContext ngay sau khi tạo
        if(audioCtx.state === 'suspended'){
            audioCtx.resume().catch(e => {
                console.warn("Failed to resume AudioContext:", e);
            });
        }
        
        // FIX: Thêm logging để debug
        console.log("Audio boost initialized for video");
        
        return audioData;
    } catch(e) {
        console.warn("Audio boost not available:", e);
        return null;
    }
}

// FIX: Thêm function để smooth gain transition
function smoothGainTransition(gainNode, targetValue, duration = 0.1){
    if(!gainNode) return;
    const currentTime = gainNode.context.currentTime;
    gainNode.gain.setValueAtTime(gainNode.gain.value, currentTime);
    gainNode.gain.linearRampToValueAtTime(targetValue, currentTime + duration);
}

// ===== HELPERS =====
function normalizeKey(key){
    return (key || "").replace(/\s+/g,'').toLowerCase();
}

function clamp(val, min, max){
    return Math.max(min, Math.min(max, val));
}

function getVideo(){
    try {
        const videos = document.querySelectorAll("video");
        // FIX: Ưu tiên video đang phát
        for (const v of videos) {
            if (v.offsetParent !== null && !v.paused && v.duration > 0) {
                return v;
            }
        }
        // Fallback: video có duration > 0
        for (const v of videos) {
            if (v.offsetParent !== null && v.duration > 0) {
                return v;
            }
        }
        // Fallback: return first visible video
        for (const v of videos) {
            if (v.offsetParent !== null) {
                return v;
            }
        }
    } catch (e) {
        console.error("Error in getVideo:", e);
    }
    return null;
}

// FIX: Thêm function để check video visibility
function isVideoVisible(video){
    if(!video) return false;
    const rect = video.getBoundingClientRect();
    return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.right > 0
    );
}

function applyVideo(){
    // FIX: Prevent multiple simultaneous calls
    if(isApplying) return;
    isApplying = true;
    
    try {
        const v = getVideo();
        if(!v) {
            isApplying = false;
            return;
        }

        const speed = clamp(settings.speed, 0.1, 16);
        const volume = clamp(settings.volume, 0, 5); // Allow boost up to 5x

        // FIX: Smooth speed transition
        if(lastApplied.speed !== speed){
            // Sử dụng requestAnimationFrame để smooth transition
            requestAnimationFrame(() => {
                v.playbackRate = speed;
            });
            lastApplied.speed = speed;
            // FIX: Thêm logging để debug
            console.log("Speed applied:", speed);
        }

        if(lastApplied.volume !== volume){
            const audioData = getOrCreateGainNode(v);
            
            if(volume <= 1){
                // Normal volume: dùng video.volume, gain = 1
                // FIX: Smooth volume transition
                requestAnimationFrame(() => {
                    v.volume = volume;
                });
                if(audioData && audioData.gain) {
                    // FIX: Smooth gain transition
                    smoothGainTransition(audioData.gain, 1);
                }
            } else {
                // Boost volume: set video.volume = 1, gain = volume
                // FIX: Nếu audio boost không khả dụng, vẫn set video.volume = 1
                requestAnimationFrame(() => {
                    v.volume = 1;
                });
                if(audioData && audioData.gain) {
                    // FIX: Smooth gain transition
                    smoothGainTransition(audioData.gain, volume);
                } else {
                    // Fallback: nếu không có audio boost, chỉ set volume = 1
                    console.warn("Audio boost not available, volume limited to 1x");
                }
            }
            
            lastApplied.volume = volume;
            // FIX: Thêm logging để debug
            console.log("Volume applied:", volume, "Audio boost:", volume > 1 ? "Yes" : "No");
        }
    } catch(e) {
        console.error("Error in applyVideo:", e);
    } finally {
        isApplying = false;
    }
}

function applyWallpaper(){
    let style = document.getElementById("yt-wallpaper");
    if(!style){
        style = document.createElement("style");
        style.id = "yt-wallpaper";
        document.head.appendChild(style);
    }

    if(!settings.wallpaper){
        style.innerHTML = "";
        return;
    }

    // FIX: Escape wallpaper URL để tránh XSS và lỗi CSS
    const escapedWallpaper = settings.wallpaper.replace(/"/g, '\\"').replace(/'/g, "\\'");
    style.innerHTML = `
        body, ytd-app {
            background: url("${escapedWallpaper}") no-repeat center center fixed !important;
            background-size: cover !important;
        }
    `;
    // FIX: Thêm logging để debug
    console.log("Wallpaper applied:", settings.wallpaper);
}

// ===== PANEL =====
const panel = document.createElement("div");
panel.id = "panel";

panel.innerHTML = `
<div id="header">
    <button id="tab1" data-tooltip="Tinh chỉnh">Tinh chỉnh</button>
    <button id="tab2" data-tooltip="Cài đặt">Cài đặt</button>
    <button id="themeToggle" data-tooltip="Đổi theme">🌓</button>
    <button id="min" data-tooltip="Thu nhỏ">_</button>
    <button id="lock" data-tooltip="Khóa">🔓</button>
</div>

<div id="control">
    <div class="row">🔊 <input type="number" id="volume" step="0.1" min="0" max="5" data-tooltip="Âm lượng (0-5x)"></div>
    <div class="row">⚡ <input type="number" id="speed" step="0.1" min="0.1" max="16" data-tooltip="Tốc độ (0.1-16x)"></div>
    <div class="row"><label><input type="checkbox" id="compactMode"> Compact</label></div>
</div>

<div id="settings" style="display:none">
    <label><input type="checkbox" id="autoShow"> Auto hiện</label><br>
    <label><input type="checkbox" id="autoVideo"> Chỉ khi có video</label>

    <br><br>
    <div class="row">🎨 Độ mờ: <input type="range" id="opacitySlider" min="0.3" max="1" step="0.1" value="${settings.opacity}"> <span id="opacityValue">${Math.round(settings.opacity*100)}%</span></div>

    <br><br>
    Wallpaper:
    <input id="wall" type="text" placeholder="URL hình nền">
    <button id="applyWall">OK</button>

    <br><br>
    Màu:
    <input type="color" id="color">

    <br><br>
    Hotkey:
    <div id="hotkeys"></div>
</div>
`;

// ===== THEME FUNCTIONS =====
function applyTheme(theme) {
    const html = document.documentElement;
    if (theme === "auto") {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        html.setAttribute("data-theme", prefersDark ? "dark" : "light");
    } else {
        html.setAttribute("data-theme", theme);
    }
    // FIX: Thêm logging để debug
    console.log("Theme applied:", theme);
}

// ===== STYLE =====
GM_addStyle(`
:root {
    --panel-bg: ${settings.color};
    --panel-text: #ffffff;
    --panel-border: rgba(255,255,255,0.2);
    --input-bg: rgba(255,255,255,0.1);
    --input-border: rgba(255,255,255,0.3);
    --btn-bg: rgba(255,255,255,0.15);
    --btn-hover: rgba(255,255,255,0.25);
}

[data-theme="dark"] {
    --panel-bg: #1a1a1a;
    --panel-text: #e0e0e0;
    --panel-border: rgba(255,255,255,0.1);
    --input-bg: rgba(255,255,255,0.08);
    --input-border: rgba(255,255,255,0.2);
    --btn-bg: rgba(255,255,255,0.1);
    --btn-hover: rgba(255,255,255,0.2);
}

[data-theme="light"] {
    --panel-bg: #f0f0f0;
    --panel-text: #333333;
    --panel-border: rgba(0,0,0,0.1);
    --input-bg: rgba(0,0,0,0.05);
    --input-border: rgba(0,0,0,0.2);
    --btn-bg: rgba(0,0,0,0.08);
    --btn-hover: rgba(0,0,0,0.15);
}

#panel{
    position:fixed;
    top:${clamp(settings.posY, 0, window.innerHeight - 100)}px;
    left:${clamp(settings.posX, 0, window.innerWidth - 250)}px;
    width:240px;
    padding:6px;
    background:var(--panel-bg);
    color:var(--panel-text);
    border-radius:10px;
    z-index:9999;
    font-family:Tahoma;
    transition: opacity 0.2s ease, background 0.3s ease;
    opacity:${settings.opacity};
}
#panel, #panel *{ user-select:none !important; }

#header{display:flex;gap:3px;cursor:move;}
.row{display:flex;gap:5px;margin:4px 0;align-items:center;}
.row input{width:80px;background:var(--input-bg);border:1px solid var(--input-border);color:var(--panel-text);}
.row span{font-size:12px;}
button{
    font-size:11px;
    border:none;
    border-radius:6px;
    cursor:pointer;
    padding:4px 8px;
    background:var(--btn-bg);
    color:var(--panel-text);
    transition: background 0.2s ease;
}
button:hover{background:var(--btn-hover);}
button:active{transform:scale(0.9);}
.keybtn{width:90px;}

#hotkeys div{
    display:flex;
    gap:4px;
    margin-bottom:3px;
    align-items:center;
}

.resetBtn{
    background:#ff4d4d;
    color:white;
}

input[type="number"],
input[type="text"]{
    padding:3px;
    border-radius:4px;
    border:1px solid var(--input-border);
    background:var(--input-bg);
    color:var(--panel-text);
}

/* Highlight volume input when boosted (>1) */
#volume.booster{
    border-color: #ff9800;
    background: linear-gradient(90deg, #fff3e0 0%, #ffe0b2 100%);
    font-weight: bold;
}

/* Theme toggle button */
#themeToggle{
    width:28px;
    height:28px;
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:14px;
}

/* Opacity slider */
#opacitySlider{
    width:100px;
    height:4px;
    -webkit-appearance:none;
    background:var(--input-border);
    border-radius:2px;
    outline:none;
}
#opacitySlider::-webkit-slider-thumb{
    -webkit-appearance:none;
    width:14px;
    height:14px;
    background:var(--panel-text);
    border-radius:50%;
    cursor:pointer;
}

/* Compact mode */
.compact-mode .row span{display:none;}
.compact-mode .row input[type="number"]{width:60px;}
.compact-mode #settings{display:none !important;}
.compact-mode #compactMode{transform:scale(0.8);margin:0;}

/* Tooltips */
[data-tooltip]{position:relative;}
[data-tooltip]:hover::after{
    content:attr(data-tooltip);
    position:absolute;
    bottom:100%;
    left:50%;
    transform:translateX(-50%);
    background:rgba(0,0,0,0.8);
    color:white;
    padding:4px 8px;
    border-radius:4px;
    font-size:10px;
    white-space:nowrap;
    z-index:10000;
    margin-bottom:4px;
}

/* Animations */
@keyframes fadeIn{
    from{opacity:0;transform:translateY(-10px);}
    to{opacity:1;transform:translateY(0);}
}
@keyframes fadeOut{
    from{opacity:1;transform:translateY(0);}
    to{opacity:0;transform:translateY(-10px);}
}
@keyframes slideIn{
    from{opacity:0;transform:translateX(100px);}
    to{opacity:1;transform:translateX(0);}
}
#panel{animation:fadeIn 0.3s ease;}
}`);

// ===== INIT =====
function init(){
    // Check if body exists, if not wait
    if(!document.body){
        requestAnimationFrame(init);
        return;
    }

    document.body.appendChild(panel);
    panel.style.display = settings.autoShow ? "block" : "none";
    applyWallpaper();
    applyTheme(settings.theme);
    initEventListeners();
    initVideoDetection();
    
    // FIX: Thêm logging để debug
    console.log("Video Control Panel PRO initialized");
    
    // FIX: Thêm smooth transitions cho tất cả các elements
    addSmoothTransitions();
}

// ===== SMOOTH TRANSITIONS =====
function addSmoothTransitions(){
    // Thêm transition cho tất cả các input elements
    const inputs = panel.querySelectorAll('input[type="number"], input[type="text"], input[type="range"]');
    inputs.forEach(input => {
        input.style.transition = 'all 0.2s ease';
    });
    
    // Thêm transition cho tất cả các buttons
    const buttons = panel.querySelectorAll('button');
    buttons.forEach(btn => {
        btn.style.transition = 'all 0.2s ease';
    });
    
    // Thêm transition cho panel
    panel.style.transition = 'opacity 0.2s ease, background 0.3s ease, transform 0.2s ease';
}

// ===== INPUT =====
const volumeInput = panel.querySelector("#volume");
const speedInput = panel.querySelector("#speed");

updateVolumeInput();
speedInput.value = settings.speed;

function updateVolumeInput(){
    volumeInput.value = settings.volume;
    volumeInput.classList.toggle("booster", settings.volume > 1);
    // FIX: Thêm logging để debug
    console.log("Volume input updated:", settings.volume);
}

volumeInput.onchange = () => {
    settings.volume = clamp(parseFloat(volumeInput.value) || 0, 0, 5);
    GM_setValue("settings", settings);
    updateVolumeInput();
    applyVideo();
    // FIX: Thêm logging để debug
    console.log("Volume changed:", settings.volume);
};

let volumeInputTimeout = null;
volumeInput.oninput = () => {
    // Live preview with debouncing
    const val = clamp(parseFloat(volumeInput.value) || 0, 0, 5);
    volumeInput.classList.toggle("booster", val > 1);
    
    // FIX: Debounce để tránh gọi quá频繁
    if(volumeInputTimeout) clearTimeout(volumeInputTimeout);
    volumeInputTimeout = setTimeout(() => {
        applyVideoToVolume(val);
    }, 50);
};

speedInput.onchange = () => {
    settings.speed = clamp(parseFloat(speedInput.value) || 1, 0.1, 16);
    GM_setValue("settings", settings);
    applyVideo();
    // FIX: Thêm logging để debug
    console.log("Speed changed:", settings.speed);
};

function applyVideoToVolume(vol) {
    const v = getVideo();
    if(!v) return;
    
    const audioData = getOrCreateGainNode(v);
    
    if(vol <= 1){
        // FIX: Smooth volume transition
        requestAnimationFrame(() => {
            v.volume = vol;
        });
        if(audioData && audioData.gain) {
            // FIX: Smooth gain transition
            smoothGainTransition(audioData.gain, 1);
        }
    } else {
        // FIX: Smooth volume transition
        requestAnimationFrame(() => {
            v.volume = 1;
        });
        if(audioData && audioData.gain) {
            // FIX: Smooth gain transition
            smoothGainTransition(audioData.gain, vol);
        } else {
            // Fallback: nếu không có audio boost, chỉ set volume = 1
            console.warn("Audio boost not available, volume limited to 1x");
        }
    }
    // FIX: Thêm logging để debug
    console.log("Volume preview:", vol, "Audio boost:", vol > 1 ? "Yes" : "No");
}

// ===== TABS =====
const control = panel.querySelector("#control");
const settingsDiv = panel.querySelector("#settings");

panel.querySelector("#tab1").onclick = () => {
    control.style.display = "block";
    settingsDiv.style.display = "none";
};

panel.querySelector("#tab2").onclick = () => {
    control.style.display = "none";
    settingsDiv.style.display = "block";
};

// ===== AUTO =====
panel.querySelector("#autoShow").checked = settings.autoShow;
panel.querySelector("#autoVideo").checked = settings.autoVideo;

panel.querySelector("#autoShow").onchange = e => {
    settings.autoShow = e.target.checked;
    GM_setValue("settings", settings);
    // FIX: Thêm logging để debug
    console.log("Auto show:", settings.autoShow);
};

panel.querySelector("#autoVideo").onchange = e => {
    settings.autoVideo = e.target.checked;
    GM_setValue("settings", settings);
    // FIX: Thêm logging để debug
    console.log("Auto video:", settings.autoVideo);
};

// ===== WALL =====
const wallInput = panel.querySelector("#wall");
wallInput.value = settings.wallpaper || "";

panel.querySelector("#applyWall").onclick = () => {
    settings.wallpaper = wallInput.value.trim();
    GM_setValue("settings", settings);
    applyWallpaper();
    // FIX: Thêm logging để debug
    console.log("Wallpaper applied:", settings.wallpaper);
};

// ===== COLOR =====
const colorInput = panel.querySelector("#color");
colorInput.value = settings.color;

colorInput.oninput = () => {
    settings.color = colorInput.value;
    document.documentElement.style.setProperty("--panel-bg", settings.color);
};

colorInput.onchange = () => {
    GM_setValue("settings", settings);
    // FIX: Thêm logging để debug
    console.log("Color changed:", settings.color);
};

// ===== THEME TOGGLE =====
const themeToggle = panel.querySelector("#themeToggle");
const themes = ["auto", "light", "dark"];
let currentThemeIndex = themes.indexOf(settings.theme);
if (currentThemeIndex === -1) currentThemeIndex = 0;

function updateThemeIcon() {
    const icons = { auto: "🌓", light: "☀️", dark: "🌙" };
    themeToggle.textContent = icons[settings.theme] || "🌓";
    // FIX: Thêm logging để debug
    console.log("Theme icon updated:", settings.theme);
}

themeToggle.onclick = () => {
    currentThemeIndex = (currentThemeIndex + 1) % themes.length;
    settings.theme = themes[currentThemeIndex];
    GM_setValue("settings", settings);
    applyTheme(settings.theme);
    updateThemeIcon();
    // FIX: Thêm logging để debug
    console.log("Theme changed:", settings.theme);
};

// Apply theme on load
applyTheme(settings.theme);
updateThemeIcon();

// Listen for system theme changes
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (settings.theme === "auto") {
        applyTheme("auto");
    }
});

// ===== OPACITY SLIDER =====
const opacitySlider = panel.querySelector("#opacitySlider");
const opacityValue = panel.querySelector("#opacityValue");

opacitySlider.oninput = () => {
    settings.opacity = parseFloat(opacitySlider.value);
    panel.style.opacity = settings.opacity;
    opacityValue.textContent = Math.round(settings.opacity * 100) + "%";
};

opacitySlider.onchange = () => {
    GM_setValue("settings", settings);
    // FIX: Thêm logging để debug
    console.log("Opacity changed:", settings.opacity);
};

// ===== COMPACT MODE =====
const compactModeCheckbox = panel.querySelector("#compactMode");
compactModeCheckbox.checked = settings.compactMode;

function applyCompactMode() {
    if (settings.compactMode) {
        panel.classList.add("compact-mode");
    } else {
        panel.classList.remove("compact-mode");
    }
    // FIX: Thêm logging để debug
    console.log("Compact mode applied:", settings.compactMode);
}

compactModeCheckbox.onchange = () => {
    settings.compactMode = compactModeCheckbox.checked;
    GM_setValue("settings", settings);
    applyCompactMode();
    // FIX: Thêm logging để debug
    console.log("Compact mode:", settings.compactMode);
};

// Apply compact mode on load
applyCompactMode();

// ===== HOTKEY =====
const actions = [
    {key:"toggle",name:"Toggle"},
    {key:"speedUp",name:"Speed+"},
    {key:"speedDown",name:"Speed-"},
    {key:"volUp",name:"Vol+"},
    {key:"volDown",name:"Vol-"},
    {key:"moveToMouse",name:"ToMouse"}
];

const hkDiv = panel.querySelector("#hotkeys");

function format(hk){
    if(!hk || !hk.key) return "Set";
    return (hk.ctrl?"Ctrl+":"") + (hk.alt?"Alt+":"") + (hk.shift?"Shift+":"") + hk.key;
}

function renderHotkeys(){
    hkDiv.innerHTML = "";

    actions.forEach(a => {
        const line = document.createElement("div");

        const label = document.createElement("span");
        label.innerText = a.name + " ";
        label.style.width = "60px";

        const btn = document.createElement("button");
        btn.className = "keybtn";
        btn.innerText = format(settings.hotkeys[a.key]);

        const reset = document.createElement("button");
        reset.innerText = "⟲";
        reset.className = "resetBtn";

        btn.onclick = () => {
            capturingKey = a.key;
            btn.innerText = "Nhập...";
            // FIX: Thêm logging để debug
            console.log("Capturing hotkey for:", a.key);
        };

        reset.onclick = () => {
            delete settings.hotkeys[a.key];
            GM_setValue("settings", settings);
            renderHotkeys();
            // FIX: Thêm logging để debug
            console.log("Hotkey reset for:", a.key);
        };

        line.append(label, btn, reset);
        hkDiv.appendChild(line);
    });

    const resetAll = document.createElement("button");
    resetAll.innerText = "Reset All";
    resetAll.className = "resetBtn";
    resetAll.style.marginTop = "8px";

    resetAll.onclick = () => {
        settings.hotkeys = {};
        GM_setValue("settings", settings);
        renderHotkeys();
        // FIX: Thêm logging để debug
        console.log("All hotkeys reset");
    };

    hkDiv.appendChild(document.createElement("br"));
    hkDiv.appendChild(resetAll);
}

renderHotkeys();

// ===== KEYBOARD =====
document.addEventListener("keydown", e => {

    // FIX: Bỏ qua nếu đang capture và phím là modifier
    if(capturingKey){
        // Chỉ accept non-modifier keys
        if(e.key === "Control" || e.key === "Alt" || e.key === "Shift" || e.key === "Meta"){
            e.preventDefault();
            return;
        }

        e.preventDefault();

        // Nếu không có modifier nào được nhấn cùng, vẫn cho phép
        const hk = {
            key: e.key.length === 1 ? e.key.toUpperCase() : e.key,
            ctrl: e.ctrlKey,
            alt: e.altKey,
            shift: e.shiftKey
        };

        // Kiểm tra trùng lặp
        for(let k in settings.hotkeys){
            if(k === capturingKey) continue;
            const existing = settings.hotkeys[k];
            if(existing && JSON.stringify(existing) === JSON.stringify(hk)){
                alert("Phím bị trùng!");
                capturingKey = null;
                renderHotkeys();
                return;
            }
        }

        settings.hotkeys[capturingKey] = hk;
        GM_setValue("settings", settings);
        capturingKey = null;
        renderHotkeys();
        // FIX: Thêm logging để debug
        console.log("Hotkey set:", capturingKey, hk);
        return;
    }

    // Xử lý hotkey đã set
    for(let k in settings.hotkeys){
        const hk = settings.hotkeys[k];
        if(!hk || !hk.key) continue;

        if(
            normalizeKey(e.key) === normalizeKey(hk.key) &&
            e.ctrlKey === !!hk.ctrl &&
            e.altKey === !!hk.alt &&
            e.shiftKey === !!hk.shift
        ){
            // Không trigger nếu đang type trong input
            if(e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA"){
                continue;
            }
            handle(k);
        }
    }
});

// ===== ACTION =====
function handle(a){
    switch(a){
        case "toggle":
            if(settings.autoVideo && !getVideo()){
                panel.style.display = "none";
                return;
            }
            // FIX: Smooth toggle animation
            if(panel.style.display === "none"){
                panel.style.display = "block";
                panel.style.animation = "fadeIn 0.3s ease";
            } else {
                panel.style.animation = "fadeOut 0.3s ease";
                setTimeout(() => {
                    panel.style.display = "none";
                }, 300);
            }
            applyVideo();
            break;

        case "speedUp": 
            settings.speed = clamp(settings.speed + 0.1, 0.1, 16); 
            // FIX: Thêm logging để debug
            console.log("Speed up:", settings.speed);
            break;
        case "speedDown": 
            settings.speed = clamp(settings.speed - 0.1, 0.1, 16); 
            // FIX: Thêm logging để debug
            console.log("Speed down:", settings.speed);
            break;
        case "volUp": 
            settings.volume = clamp(settings.volume + 0.1, 0, 5); 
            // FIX: Thêm logging để debug
            console.log("Volume up:", settings.volume);
            break;
        case "volDown": 
            settings.volume = clamp(settings.volume - 0.1, 0, 5); 
            // FIX: Thêm logging để debug
            console.log("Volume down:", settings.volume);
            break;

        case "moveToMouse":
            // FIX: Smooth move animation
            panel.style.transition = "left 0.2s ease, top 0.2s ease";
            panel.style.left = clamp(lastMouseX, 0, window.innerWidth - 250) + "px";
            panel.style.top = clamp(lastMouseY, 0, window.innerHeight - 100) + "px";
            setTimeout(() => {
                panel.style.transition = "opacity 0.2s ease, background 0.3s ease, transform 0.2s ease";
            }, 200);
            break;
    }

    GM_setValue("settings", settings);
    applyVideo();
    
    // Update inputs
    updateVolumeInput();
    speedInput.value = settings.speed;
}

// ===== MOUSE TRACKING =====
document.addEventListener("mousemove", e => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
});

// ===== DRAG =====
const header = panel.querySelector("#header");

header.addEventListener("mousedown", e => {
    if(isLocked) return;
    // Không drag nếu click vào button
    if(e.target.tagName === "BUTTON" || e.target.tagName === "INPUT") return;
    
    e.preventDefault();
    isDragging = true;
    offsetX = e.clientX - panel.offsetLeft;
    offsetY = e.clientY - panel.offsetTop;
});

document.addEventListener("mousemove", e => {
    if(!isDragging) return;

    if(raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
        const newLeft = clamp(e.clientX - offsetX, 0, window.innerWidth - 250);
        const newTop = clamp(e.clientY - offsetY, 0, window.innerHeight - 100);
        panel.style.left = newLeft + "px";
        panel.style.top = newTop + "px";
        raf = null;
    });
});

document.addEventListener("mouseup", () => {
    if(isDragging){
        settings.posX = panel.offsetLeft;
        settings.posY = panel.offsetTop;
        GM_setValue("settings", settings);
        // FIX: Thêm logging để debug
        console.log("Panel position saved:", settings.posX, settings.posY);
    }
    isDragging = false;
});

// ===== LOCK =====
panel.querySelector("#lock").onclick = function(){
    isLocked = !isLocked;
    this.textContent = isLocked ? "🔒" : "🔓";
    header.style.cursor = isLocked ? "default" : "move";
    // FIX: Thêm logging để debug
    console.log("Panel locked:", isLocked);
};

// ===== MIN =====
panel.querySelector("#min").onclick = () => {
    control.style.display =
        control.style.display === "none" ? "block" : "none";
    // FIX: Thêm logging để debug
    console.log("Panel minimized:", control.style.display === "none");
};

// ===== VIDEO DETECTION =====
let detectionTimeout = null;
let lastDetectionTime = 0;
const DETECTION_DEBOUNCE = 100; // ms

function detectVideoOnce(){
    const now = Date.now();
    // Debounce: tránh gọi quá频繁
    if(now - lastDetectionTime < DETECTION_DEBOUNCE){
        if(detectionTimeout) clearTimeout(detectionTimeout);
        detectionTimeout = setTimeout(() => detectVideoOnce(), DETECTION_DEBOUNCE);
        return;
    }
    lastDetectionTime = now;
    
    const v = getVideo();

    if(v !== lastVideo){
        // Cleanup old video listeners
        if(lastVideo){
            lastVideo.removeEventListener('canplay', onVideoReady);
            lastVideo.removeEventListener('loadedmetadata', onVideoReady);
            lastVideo.removeEventListener('error', onVideoError);
            // FIX: Cleanup audio context khi video bị remove
            cleanupAudioContext(lastVideo);
        }
        
        lastVideo = v;

        if(settings.autoVideo){
            // FIX: Smooth show/hide animation
            if(v){
                panel.style.display = "block";
                panel.style.animation = "fadeIn 0.3s ease";
            } else {
                panel.style.animation = "fadeOut 0.3s ease";
                setTimeout(() => {
                    panel.style.display = "none";
                }, 300);
            }
        }

        if(v){
            // FIX: Thêm logging để debug
            console.log("Video detected:", v.src || v.currentSrc);
            
            // Thêm listeners cho video mới
            v.addEventListener('canplay', onVideoReady);
            v.addEventListener('loadedmetadata', onVideoReady);
            v.addEventListener('error', onVideoError);
            
            // Apply ngay nếu video đã sẵn sàng
            if(v.readyState >= 2){ // HAVE_CURRENT_DATA or higher
                applyVideo();
            }
        }
    }
}

function onVideoReady(){
    // Video đã sẵn sàng, apply settings ngay
    // FIX: Thêm logging để debug
    console.log("Video ready, applying settings...");
    applyVideo();
}

function onVideoError(e){
    console.warn("Video error detected:", e);
    // Không crash, chỉ log
    // FIX: Thêm error handling chi tiết hơn
    const video = e.target;
    if(video && video.error){
        const error = video.error;
        switch(error.code){
            case MediaError.MEDIA_ERR_ABORTED:
                console.warn("Video playback was aborted");
                break;
            case MediaError.MEDIA_ERR_NETWORK:
                console.warn("Network error while loading video");
                break;
            case MediaError.MEDIA_ERR_DECODE:
                console.warn("Video decoding error");
                break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                console.warn("Video source not supported");
                break;
            default:
                console.warn("Unknown video error");
        }
    }
    // FIX: Thêm logging để debug
    console.log("Video error details:", video ? video.error : "No video element");
}

function initVideoDetection(){
    // Initial detection on load
    if(document.readyState === "complete"){
        detectVideoOnce();
    } else {
        window.addEventListener("load", detectVideoOnce);
    }

    // FIX: Thêm visibility change để detect khi tab active
    document.addEventListener("visibilitychange", () => {
        if(!document.hidden){
            detectVideoOnce();
        }
    });

    // FIX: Thêm play event
    document.addEventListener("play", e => {
        if(e.target.tagName === "VIDEO"){
            detectVideoOnce();
        }
    }, true);

    // FIX: Thêm thêm events để detect video tốt hơn
    document.addEventListener("playing", e => {
        if(e.target.tagName === "VIDEO"){
            detectVideoOnce();
        }
    }, true);
    
    document.addEventListener("loadeddata", e => {
        if(e.target.tagName === "VIDEO"){
            detectVideoOnce();
        }
    }, true);
    
    // FIX: Thêm thêm events để detect video source changes
    document.addEventListener("loadstart", e => {
        if(e.target.tagName === "VIDEO"){
            console.log("Video loadstart detected");
            detectVideoOnce();
        }
    }, true);
    
    document.addEventListener("durationchange", e => {
        if(e.target.tagName === "VIDEO"){
            console.log("Video durationchange detected");
            detectVideoOnce();
        }
    }, true);

    // FIX: Optimized MutationObserver - observe cả addedNodes và attributes
    if(observer) observer.disconnect();
    
    observer = new MutationObserver(mutations => {
        let shouldCheck = false;
        for(const mut of mutations){
            // Check added nodes
            if(mut.addedNodes.length > 0){
                for(const node of mut.addedNodes){
                    if(node.nodeName === "VIDEO" || 
                       (node.querySelector && node.querySelector("video"))){
                        shouldCheck = true;
                        break;
                    }
                }
            }
            // Check removed nodes
            if(mut.removedNodes.length > 0){
                for(const node of mut.removedNodes){
                    if(node.nodeName === "VIDEO" || 
                       (node.querySelector && node.querySelector("video"))){
                        // Video bị remove, check lại
                        shouldCheck = true;
                        break;
                    }
                }
            }
            // Check attribute changes on video elements
            if(mut.type === 'attributes' && mut.target.nodeName === 'VIDEO'){
                shouldCheck = true;
            }
            if(shouldCheck) break;
        }
        if(shouldCheck){
            detectVideoOnce();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'currentSrc', 'style', 'class']
    });
}

// ===== EVENT LISTENERS =====
function initEventListeners(){
    // Window resize - đảm bảo panel không bị mất
    window.addEventListener("resize", () => {
        panel.style.left = clamp(parseInt(panel.style.left) || 0, 0, window.innerWidth - 250) + "px";
        panel.style.top = clamp(parseInt(panel.style.top) || 0, 0, window.innerHeight - 100) + "px";
        // FIX: Thêm logging để debug
        console.log("Window resized, panel position adjusted");
    });
}

// ===== START =====
init();

// FIX: Thêm version info để debug
console.log("Video Control Panel PRO v" + CURRENT_VERSION + " - Optimized with instant detection, volume boost, and error handling");

// Check for updates on startup
checkForUpdates();

})();
