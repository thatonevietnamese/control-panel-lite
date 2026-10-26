// ==UserScript==
// @name                 YouTube Ads-Bypass
// @name:ar              YouTube Ads-Bypass (تخطي وإخفاء جميع الإعلانات)
// @name:bn              YouTube Ads-Bypass (সব বিজ্ঞাপন এড়িয়ে যান এবং লুকান)
// @name:cs              YouTube Ads-Bypass (Přeskočit a skrýt všechny reklamy)
// @name:de              YouTube Ads-Bypass (Anzeigen überspringen und ausblenden)
// @name:en              YouTube Ads-Bypass (Skip and Hide All Ads)
// @name:es              YouTube Ads-Bypass (Saltar y ocultar todos los anuncios)
// @name:fa              YouTube Ads-Bypass (رد کردن و پنهان کردن همه تبلیغات)
// @name:fr              YouTube Ads-Bypass (Passer et masquer toutes les publicités)
// @name:hi              YouTube Ads-Bypass (सभी विज्ञापन छोड़ें और छुपाएं)
// @name:id              YouTube Ads-Bypass (Lewati dan Sembunyikan Semua Iklan)
// @name:it              YouTube Ads-Bypass (Salta e nascondi tutti gli annunci)
// @name:ja              YouTube Ads-Bypass (すべての広告をスキップして非表示にする)
// @name:ko              YouTube Ads-Bypass (모든 광고 건너뛰기 및 숨기기)
// @name:nl              YouTube Ads-Bypass (Alle advertenties overslaan en verbergen)
// @name:pl              YouTube Ads-Bypass (Pomiń i ukryj wszystkie reklamy)
// @name:pt              YouTube Ads-Bypass (Pular e Ocultar Todos os Anúncios)
// @name:ro              YouTube Ads-Bypass (Sari peste și ascunde toate reclamele)
// @name:ru              YouTube Ads-Bypass (Пропуск и скрытие всей рекламы)
// @name:th              YouTube Ads-Bypass (ข้ามและซ่อนโฆษณาทั้งหมด)
// @name:tr              YouTube Ads-Bypass (Tüm Reklamları Atla ve Gizle)
// @name:uk              YouTube Ads-Bypass (Пропустити та приховати всю рекламу)
// @name:vi              YouTube Ads-Bypass (Bỏ qua và ẩn tất cả quảng cáo)
// @name:zh-CN           YouTube Ads-Bypass (跳过并隐藏所有广告)
// @name:zh-TW           YouTube Ads-Bypass (跳過並隱藏所有廣告)
// @namespace            YouTube_Ad-Bypass_Fckoff
// @version              1.28.3
// @description:ar       سكربت خفيف وعالي الأداء لتخطي إعلانات الفيديو وإخفاء عناصر واجهة المستخدم المزعجة (اللافتات، التراكبات، والعروض الترويجية).
// @description:bn       ভিডিও বিজ্ঞাপন এড়িয়ে যাওয়ার এবং বিরক্তিকর ইউআই উপাদান (ব্যানার, ওভারলে এবং প্রমো) লুকানোর জন্য লাইটওয়েট এবং উচ্চ-ক্ষমতাসম্পন্ন স্ক্রিপ্ট।
// @description:cs       Lehký a vysoce výkonný skript pro přeskočení video reklam a skrytí otravných prvků rozhraní (bannery, překryvy a promo akce).
// @description:de       Leichtes und leistungsstarkes Skript zum Überspringen von Videoanzeigen und Ausblenden aufdringlicher UI-Elemente (Banner, Overlays und Promos).
// @description:en       Lightweight and high-performance script to skip video ads and hide intrusive UI elements (banners, overlays, and promos).
// @description:es       Script ligero y de alto rendimiento para saltar anuncios de video y ocultar elementos molestos de la interfaz (banners, superposiciones y promos).
// @description:fa       اسکریپت سبک و با کارایی بالا برای رد کردن تبلیغات ویدیویی و پنهان کردن عناصر مزاحم رابط کاربری (بنرها، اورلی‌ها و پروموها).
// @description:fr       Script léger et performant pour passer les publicités vidéo et masquer les éléments d'interface intrusifs (bannières, superpositions et promos).
// @description:hi       वीडियो विज्ञापन छोड़ने और दखल देने वाले यूआई तत्वों (बैनर, ओवरले और प्रोमो) को छिपाने के लिए हल्का और उच्च प्रदर्शन वाला स्क्रिप्ट।
// @description:id       Skrip ringan dan berkinerja tinggi untuk melewati iklan video dan menyembunyikan elemen UI yang mengganggu (banner, overlay, dan promo).
// @description:it       Script leggero e ad alte prestazioni per saltare gli annunci video e nascondere elementi dell'interfaccia utente invadenti (banner, sovrapposizioni e promozioni).
// @description:ja       動画広告をスキップし、邪魔なUI要素（バナー、オーバーレイ、プロモーション）を非表示にする、軽量で高性能なスクリプト。
// @description:ko       동영상 광고를 건너뛰고 방해되는 UI 요소(배너, 오버레이, 프로모션)를 숨기는 가볍고 고성능인 스크립트.
// @description:nl       Lichtgewicht en krachtig script om video-advertenties over te slaan en storende UI-elementen (banners, overlays en promo's) te verbergen.
// @description:pl       Lekki i wydajny skrypt do pomijania reklam wideo i ukrywania uciążliwych elementów interfejsu (banerów, nakładek i promocji).
// @description:pt       Script leve e de alto desempenho para pular anúncios em vídeo e ocultar elementos intrusivos da interface (banners, sobreposições e promos).
// @description:ro       Script ușor și performant pentru a omite reclamele video și a ascunde elementele UI intruzive (bannere, suprapuneri și promoții).
// @description:ru       Легкий и высокопроизводительный скрипт для пропуска видеорекламы и скрытия навязчивых элементов интерфейса (баннеров, оверлеев и промо).
// @description:th       สคริปต์น้ำหนักเบาและประสิทธิภาพสูงสำหรับข้ามโฆษณาวิดีโอและซ่อนองค์ประกอบ UI ที่น่ารำคาญ (แบนเนอร์, ป๊อปอัป, และโปรโมชัน)
// @description:tr       Video reklamlarını atlamak ve rahatsız edici kullanıcı arayüzü öğelerini (banner'lar, katmanlar ve promosyonlar) gizlemek için hafif ve yüksek performanslı betik.
// @description:uk       Легкий і високопродуктивний скрипт для пропуску відеореклами та приховування нав'язливих елементів інтерфейсу (банерів, оверлеїв та промо).
// @description:vi       Script nhẹ và hiệu suất cao giúp bỏ qua quảng cáo video và ẩn các thành phần giao diện gây phiền nhiễu (banner, lớp phủ và quảng cáo).
// @description:zh-CN    轻量且高效的脚本，用于跳过视频广告并隐藏干扰性 UI 元素（横幅、覆盖层和促销活动）。
// @description:zh-TW    輕量且高效的腳本，用於跳過影片廣告並隱藏干擾性 UI 元素（橫幅、蓋台廣告和促銷活動）。
// @author               WakeUpNeo
// @match                *://www.youtube.com/*
// @match                *://music.youtube.com/*
// @run-at               document-start
// @grant                none
// @license              MIT
// @description Script ligero y de alto rendimiento para saltar anuncios de video y ocultar elementos molestos de la interfaz (banners, superposiciones y promos).
// @downloadURL https://update.greasyfork.org/scripts/575941/YouTube%20Ads-Bypass.user.js
// @updateURL https://update.greasyfork.org/scripts/575941/YouTube%20Ads-Bypass.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // Opciones del Sistema
    // ==========================================
    const CONFIG = {
      debug: true,
      prefix: '[YouTube Ads-Bypass]',
      maxCheckAttempt: 2
    };

    const LANGS = {
        ar: { wait_or_skip: 'انتظر أو اضغط تخطي' }, // Árabe
        bn: { wait_or_skip: 'অপেক্ষা করুন বা স্কিপ টিপুন' }, // Bengalí
        cs: { wait_or_skip: 'Počkejte nebo klikněte na Přeskočit' }, // Checo
        de: { wait_or_skip: 'Warten oder Überspringen' }, // Alemán
        el: { wait_or_skip: 'Περιμένετε ή πατήστε Παράλειψη' }, // Griego
        en: { wait_or_skip: 'Wait or Press Skip' }, // Inglés
        es: { wait_or_skip: 'Espera o Presiona Saltar' }, // Español
        fa: { wait_or_skip: 'منتظر بمانید یا رد کردن را فشار دهید' }, // Persa
        fr: { wait_or_skip: 'Attendre ou Passer' }, // Francés
        he: { wait_or_skip: 'המתן או לחץ על דילוג' }, // Hebreo
        hi: { wait_or_skip: 'प्रतीक्षा करें या छोड़ें दबाएं' }, // Hindi
        hu: { wait_or_skip: 'Várjon vagy nyomja meg a Kihagyást' }, // Húngaro
        id: { wait_or_skip: 'Tunggu atau Tekan Lewati' }, // Indonesio
        it: { wait_or_skip: 'Aspetta o Premi Salta' }, // Italiano
        ja: { wait_or_skip: '待つかスキップを押す' }, // Japonés
        ko: { wait_or_skip: '기다리거나 건너뛰기 누르기' }, // Coreano
        nl: { wait_or_skip: 'Wacht of druk op Overslaan' }, // Neerlandés
        pl: { wait_or_skip: 'Czekaj lub naciśnij Pomiń' }, // Polaco
        pt: { wait_or_skip: 'Aguarde ou Pressione Pular' }, // Portugués
        ro: { wait_or_skip: 'Așteaptă sau apasă Înapoi/Sari' }, // Rumano
        ru: { wait_or_skip: 'Подождите или нажмите Пропустить' }, // Ruso
        sv: { wait_or_skip: 'Vänta eller tryck på Hoppa över' }, // Sueco
        th: { wait_or_skip: 'รอหรือกดข้าม' }, // Tailandés
        tr: { wait_or_skip: 'Bekleyin veya Atla Tuşuna Basın' }, // Turco
        uk: { wait_or_skip: 'Зачекайте або натисніть Пропустити' }, // Ucraniano
        vi: { wait_or_skip: 'Chờ hoặc nhấn Bỏ qua' }, // Vietnamita
        zh: { wait_or_skip: '等待或点击跳过' } // Chino
    };

    const userLang = navigator.language.substring(0, 2);
    const LNG = (userLang in LANGS) ? LANGS[userLang] : LANGS.en;

    /**
    * Centralized message router for the developer console.
    * Applies a standard prefix and allows categorization by alert levels.
    */
    function log(message) {
        console.log(`${CONFIG.prefix} ⚙️ ${message}`);
    }

    log('Starting script...');

    /**
     * Configuration object containing CSS selectors for different types of ad elements.
     */
    const SELECTORS = {
        // Elements that should be visually hidden from the UI
        toHide: [
            '.ytp-ad-message-container',
            'ytd-player-legacy-desktop-watch-ads-renderer',
            'ytd-ad-slot-renderer',
            '#masthead-ad',
            'tp-yt-paper-dialog:has(#feedback.ytd-enforcement-message-view-model)',
            '.yt-mealbar-promo-renderer',
            '.ytp-ad-player-overlay-layout__player-card-container',
            '.ytp-ad-player-overlay-layout__ad-info-container',
            '.ytp-ad-player-overlay-layout__ad-disclosure-banner-container',
            '.ytp-ad-player-overlay',
            '.ad-showing > video',
            '.ad-interrupting > video',
            'div:has(> div#banner)',
            'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
            'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
            'ytmusic-mealbar-promo-renderer',
            'ytd-in-feed-ad-layout-renderer',
            '#player-ads',
            '.ytd-video-masthead-ad-v3-renderer',
            'ytd-ad-selection-preview-renderer',
            '.ytp-ad-image-overlay',
            '#root.yt-chips-search-renderer-header-v2',
            '.ytp-cued-thumbnail-overlay',
            '.ytp-ad-avatar',
            '.ytp-ad-button-vm'
        ],
        // Selectors for the main YouTube video player container
        player: [
            '#movie_player',
            '.html5-video-player'
        ],
        // Selectors for the various "Skip Ad" buttons
        skipButtons: [
            '.ytp-ad-skip-button-modern',
            '.ytp-skip-ad-button',
            '.ytp-ad-skip-button',
            '.ytp-ad-skip-button-slot',
            '.ytp-ad-skip-button-container'
        ]
    };

    // Classes added by YouTube when an ad is active
    const adsClasses = [
        'ad-showing',
        'ad-interrupting',
        'ytp-ad-player-overlay',
        'ytp-ad-display-override'
    ];

    const selector = {
        playerSpinner: '.ytp-spinner',
        adPlayerOverlay: '.ytp-ad-player-overlay-layout',
        cuedThumbOverlay: '.ytp-cued-thumbnail-overlay',
    };


    /**
     * Convert arrays of selectors into single comma-separated strings for querySelectorAll/matches usage.
     */
    const selectors = Object.fromEntries(
       Object.entries(SELECTORS).map(([key, value]) => [key, value.join(', ')])
    );

    let player = null;
    let playerObserver = null;
    let video = null;
    let spinner = null;
    let cuedThumbOverlay = null;
    let lastSkipAttempt = 0;
    let lastCheckAttempt = 0;
    let isAdDetected = false;

    /**
     * Injects a global <style> tag to hide ad-related elements using CSS.
     * Uses visibility:hidden and 1px size to avoid breaking layout while making ads invisible.
     */
    const injectStyles = () => {
        const style = document.createElement('style');
        style.textContent = `
             @keyframes animateSkip {
               0% {
                   transform: translate(-8px, 0);
                   opacity: 0;
               }
               25% {
                   opacity: 1;
               }
               75% {
                   opacity: 1;
               }
               100% {
                   transform: translate(30px, 0);
                   opacity: 0;
               }
            }
            ${selectors.toHide} {
                display: flex !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
                height: 1px !important;
                width: 1px !important;
                overflow: hidden !important;
            }
            ${selectors.skipButtons} {
                display: flex !important;
                text-transform: uppercase !important;
                border: 1px solid #fd0 !important;
                background-color: rgba(255,230,50,0.65) !important;
                box-shadow: 0 0 20px #fc0 !important;
                overflow: hidden !important;
            }
            ${adsClasses.map(c => `.${c} .ytp-spinner-circle`).join(', ')} {
                border-color: #fc0 #fc0 transparent !important;
            }
            .ytp-skip-ad,
            .ytp-prev-button,
            .ytp-next-button {
                display: flex !important;
            }
            .ad-simple-attributed-string {
                visibility: hidden;
            }
            .ad-simple-attributed-string::before {
                content: "${LNG.wait_or_skip}";
                display: flex !important;
                visibility: visible;
                color: white;
                width: 100% !important;
                justify-content: center !important;
                white-space: nowrap !important;
            }
            .ytp-skip-ad-button__icon {
                transform: translate(-8px, 0);
                animation: 1s linear 0s infinite animateSkip;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
        log('Styles injected');
    };

    /**
     * Checks if the player has some ad class.
     */
     const isAdActive = () => {
         return adsClasses.some(function(item) {
             return player.classList.contains(item);
         });
     };

    /**
     * Executes the skipping logic: fast-forwards the video to the end and clicks the skip button.
     */
    const skipAction = () => {
        const overlay = player.querySelector(selector.adPlayerOverlay);
        if (overlay){
            overlay.style.display = '';
            overlay.setAttribute('style', '');
        }
        if (spinner){
            spinner.style.display = '';
        }
        if (cuedThumbOverlay){
            cuedThumbOverlay.style.display = 'none';
        }
        if (video.style.display != 'none') {
            video.style.display = 'none';
        }
        if (!video.paused){
            log('Ad paused');
            video.pause();
            video.paused = true;
        }
        if (!video.muted) {
            video.muted = true;
            log('Ad muted');
        }
        if (video.playbackRate != 2.0) {
            video.playbackRate = 2.0;
            log('Ad accelerated');
        }
        if (isFinite(video.duration) && video.duration > 0) {
            video.currentTime = video.duration - 0.1;
            log('Ad seekToEnd');
        }
        if (video.style.display == 'none') {
            video.style.display = 'block';
        }
        /* It was deactivated because this triggers the YouTube block
        if (video.paused) {
            video.play();
            log('Ad play');
        }
        */
    };

    /**
     * Checks if the player is currently showing an ad.
     */
    const checkVideoAds = () => {
       // Re-fetch the video element if it's missing or disconnected from DOM
       if (!video || !video.isConnected) {
            video = player.querySelector('video');
        }
        if (!video) return;

        const now = Date.now();
        // Throttle skip attempts to avoid rapid loops
        if (now - lastSkipAttempt < 250) return;
        lastSkipAttempt = now;

        // If player has ad-related classes, trigger skip; otherwise, reset playback speed
        if ( isAdActive() ) {
            isAdDetected = true;
            lastCheckAttempt = CONFIG.maxCheckAttempt;
            log('SkipAd start');
            skipAction();
            log('SkipAd end');
        } else if (lastCheckAttempt > 0) {
            isAdDetected = false;
            lastCheckAttempt--;
            if (video.style.display == 'none') {
                video.style.display = 'block';
            }
            if (spinner) {
                spinner.style.display = 'none';
                log('Hide cued thumbnail');
            }
            if (cuedThumbOverlay){
                cuedThumbOverlay.style.display = 'none';
                log('Hide spinner');
            }
            if (video.muted) {
                video.muted = false;
                log('Restore mute');
            }
            // Restore normal speed if the script had previously accelerated it
            if (video.playbackRate > 1) {
                video.playbackRate = 1;
                log('Restore playRate');
            }
            /* It was deactivated because this triggers the YouTube block
            if (video.paused) {
                video.play();
                log('Restore pause');
            }
            */
            log('Restore Play');
        }
    };


    /**
     * Initializes a MutationObserver to watch for changes in the player's class attribute.
     * This allows the script to react instantly when an ad starts.
     */
    const setupPlayerObserver = () => {
        if (!player) {
            player = document.querySelector(selectors.player);
        }

        if (player && !playerObserver) {
            video = player.querySelector('video');

            playerObserver = new MutationObserver(() => checkVideoAds());
            // Monitor class changes which indicate ad transitions
            playerObserver.observe(player, { attributes: true, attributeFilter: ['class'] });

             // Run initial check
            checkVideoAds();
        }
    };

    // Event listeners to handle page loads and YouTube's internal navigation (SPA)
    window.addEventListener('yt-navigate-finish', setupPlayerObserver);
    window.addEventListener('yt-page-data-updated', setupPlayerObserver);

    window.addEventListener('load', (event) => {
        if (!player) {
            player = document.querySelector(selectors.player);
        }
        if (player) {
            spinner = player.querySelector(selector.playerSpinner);
            cuedThumbOverlay = player.querySelector(selector.cuedThumbOverlay);
        }
        setupPlayerObserver();
    });

    // Inject CSS as soon as the DOM structure is available
    window.addEventListener('DOMContentLoaded', (event) => {
        injectStyles();
    });

    /**
     * Fallback mechanism: attempts to initialize the observer every 1000ms
     * in case 'load' events fire before the player is ready.
     */
    let retry = 0;
    const fallback = setInterval(() => {
        log('attempt setupPlayerObserver:' + retry);
        setupPlayerObserver();
        // Stop retrying if observer is active or after 10 failed attempts
        if (playerObserver || retry > 10) clearInterval(fallback);
        retry++;
    }, 1000);

    log('Script loaded!');
})();
