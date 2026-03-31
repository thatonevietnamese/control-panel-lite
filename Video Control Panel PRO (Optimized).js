// ==UserScript==
// @name         Video Control Panel PRO (Optimized)
// @namespace    http://tampermonkey.net/
// @version      15.0
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @description  tối ưu mạnh + mượt + fix bug + theme + opacity + compact mode (v15)
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
    compactMode: false
});

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

// ===== AUDIO BOOST =====
// Cache audio contexts và gain nodes cho từng video
const audioContexts = new WeakMap();

function getOrCreateGainNode(video){
    if(audioContexts.has(video)){
        return audioContexts.get(video);
    }
    
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(video);
        const gainNode = audioCtx.createGain();
        
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        const audioData = { ctx: audioCtx, gain: gainNode };
        audioContexts.set(video, audioData);
        
        return audioData;
    } catch(e) {
        console.warn("Audio boost not available:", e);
        return null;
    }
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
    } catch (e) {}
    return null;
}

function applyVideo(){
    const v = getVideo();
    if(!v) return;

    const speed = clamp(settings.speed, 0.1, 16);
    const volume = clamp(settings.volume, 0, 5); // Allow boost up to 5x

    if(lastApplied.speed !== speed){
        v.playbackRate = speed;
        lastApplied.speed = speed;
    }

    if(lastApplied.volume !== volume){
        const audioData = getOrCreateGainNode(v);
        
        if(volume <= 1){
            // Normal volume: dùng video.volume, gain = 1
            v.volume = volume;
            if(audioData) audioData.gain.gain.value = 1;
        } else {
            // Boost volume: set video.volume = 1, gain = volume
            v.volume = 1;
            if(audioData) audioData.gain.gain.value = volume;
        }
        
        lastApplied.volume = volume;
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
}

// ===== INPUT =====
const volumeInput = panel.querySelector("#volume");
const speedInput = panel.querySelector("#speed");

updateVolumeInput();
speedInput.value = settings.speed;

function updateVolumeInput(){
    volumeInput.value = settings.volume;
    volumeInput.classList.toggle("booster", settings.volume > 1);
}

volumeInput.onchange = () => {
    settings.volume = clamp(parseFloat(volumeInput.value) || 0, 0, 5);
    GM_setValue("settings", settings);
    updateVolumeInput();
    applyVideo();
};

volumeInput.oninput = () => {
    // Live preview
    const val = clamp(parseFloat(volumeInput.value) || 0, 0, 5);
    volumeInput.classList.toggle("booster", val > 1);
    applyVideoToVolume(val);
};

speedInput.onchange = () => {
    settings.speed = clamp(parseFloat(speedInput.value) || 1, 0.1, 16);
    GM_setValue("settings", settings);
    applyVideo();
};

function applyVideoToVolume(vol) {
    const v = getVideo();
    if(!v) return;
    
    const audioData = getOrCreateGainNode(v);
    
    if(vol <= 1){
        v.volume = vol;
        if(audioData) audioData.gain.gain.value = 1;
    } else {
        v.volume = 1;
        if(audioData) audioData.gain.gain.value = vol;
    }
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
};

panel.querySelector("#autoVideo").onchange = e => {
    settings.autoVideo = e.target.checked;
    GM_setValue("settings", settings);
};

// ===== WALL =====
const wallInput = panel.querySelector("#wall");
wallInput.value = settings.wallpaper || "";

panel.querySelector("#applyWall").onclick = () => {
    settings.wallpaper = wallInput.value.trim();
    GM_setValue("settings", settings);
    applyWallpaper();
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
};

// ===== THEME TOGGLE =====
const themeToggle = panel.querySelector("#themeToggle");
const themes = ["auto", "light", "dark"];
let currentThemeIndex = themes.indexOf(settings.theme);
if (currentThemeIndex === -1) currentThemeIndex = 0;

function updateThemeIcon() {
    const icons = { auto: "🌓", light: "☀️", dark: "🌙" };
    themeToggle.textContent = icons[settings.theme] || "🌓";
}

themeToggle.onclick = () => {
    currentThemeIndex = (currentThemeIndex + 1) % themes.length;
    settings.theme = themes[currentThemeIndex];
    GM_setValue("settings", settings);
    applyTheme(settings.theme);
    updateThemeIcon();
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
}

compactModeCheckbox.onchange = () => {
    settings.compactMode = compactModeCheckbox.checked;
    GM_setValue("settings", settings);
    applyCompactMode();
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
        };

        reset.onclick = () => {
            delete settings.hotkeys[a.key];
            GM_setValue("settings", settings);
            renderHotkeys();
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
            panel.style.display =
                panel.style.display === "none" ? "block" : "none";
            applyVideo();
            break;

        case "speedUp": 
            settings.speed = clamp(settings.speed + 0.1, 0.1, 16); 
            break;
        case "speedDown": 
            settings.speed = clamp(settings.speed - 0.1, 0.1, 16); 
            break;
        case "volUp": 
            settings.volume = clamp(settings.volume + 0.1, 0, 5); 
            break;
        case "volDown": 
            settings.volume = clamp(settings.volume - 0.1, 0, 5); 
            break;

        case "moveToMouse":
            panel.style.left = clamp(lastMouseX, 0, window.innerWidth - 250) + "px";
            panel.style.top = clamp(lastMouseY, 0, window.innerHeight - 100) + "px";
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
    }
    isDragging = false;
});

// ===== LOCK =====
panel.querySelector("#lock").onclick = function(){
    isLocked = !isLocked;
    this.textContent = isLocked ? "🔒" : "🔓";
    header.style.cursor = isLocked ? "default" : "move";
};

// ===== MIN =====
panel.querySelector("#min").onclick = () => {
    control.style.display =
        control.style.display === "none" ? "block" : "none";
};

// ===== VIDEO DETECTION =====
function detectVideoOnce(){
    const v = getVideo();

    if(v !== lastVideo){
        lastVideo = v;

        if(settings.autoVideo){
            panel.style.display = v ? "block" : "none";
        }

        applyVideo();
    }
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

    // FIX: Optimized MutationObserver - chỉ observe thay đổi mới
    if(observer) observer.disconnect();
    
    observer = new MutationObserver(mutations => {
        let shouldCheck = false;
        for(const mut of mutations){
            if(mut.addedNodes.length > 0){
                for(const node of mut.addedNodes){
                    if(node.nodeName === "VIDEO" || 
                       (node.querySelector && node.querySelector("video"))){
                        shouldCheck = true;
                        break;
                    }
                }
            }
            if(shouldCheck) break;
        }
        if(shouldCheck){
            detectVideoOnce();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// ===== EVENT LISTENERS =====
function initEventListeners(){
    // Window resize - đảm bảo panel không bị mất
    window.addEventListener("resize", () => {
        panel.style.left = clamp(parseInt(panel.style.left) || 0, 0, window.innerWidth - 250) + "px";
        panel.style.top = clamp(parseInt(panel.style.top) || 0, 0, window.innerHeight - 100) + "px";
    });
}

// ===== START =====
init();

})();
