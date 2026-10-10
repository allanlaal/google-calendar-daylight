// ==UserScript==
// @name         Google Calendar - Per-Day Daylight Highlights
// @namespace    http://github.com/allanlaal/google-calendar-daylight
// @version      8.1
// @description  Accurately calculates daylight per day, excluding all-day and date header rows.
// @author       Allan
// @match        https://calendar.google.com/calendar/*
// @downloadURL  https://raw.githubusercontent.com/allanlaal/google-calendar-daylight/main/google-calendar-daylight.user.js
// @updateURL    https://raw.githubusercontent.com/allanlaal/google-calendar-daylight/main/google-calendar-daylight.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // --- PERSISTENT STORAGE (GM Storage with localStorage Backup) ---
    function getStoredValue(key, defaultValue) {
        try {
            if (typeof GM_getValue !== 'undefined') {
                const val = GM_getValue(key);
                if (val !== undefined && val !== null) return val;
            }
            const localVal = localStorage.getItem(`gcal_daylight_${key}`);
            if (localVal !== null) return JSON.parse(localVal);
        } catch (e) {}
        return defaultValue;
    }

    function setStoredValue(key, value) {
        try {
            if (typeof GM_setValue !== 'undefined') {
                GM_setValue(key, value);
            }
            localStorage.setItem(`gcal_daylight_${key}`, JSON.stringify(value));
        } catch (e) {}
    }

    function getDetectedTimezone() {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Tallinn'; }
        catch (e) { return 'Europe/Tallinn'; }
    }

    const CONFIG = {
        fallbackLat: getStoredValue('user_lat', 59.0000),
        fallbackLng: getStoredValue('user_lng', 25.0000),
        userTimezone: getStoredValue('user_tz', getDetectedTimezone()),
        twilightType: getStoredValue('twilight_type', 'civil'),
        daylightColor: 'rgba(231, 186, 81, 1)' // #e7ba51
    };

    const TWILIGHT_DEFINITIONS = {
        official: { label: "Official Daylight (0°)", desc: "Sun center is above the horizon. Full daylight." },
        civil: { label: "Civil Twilight (-6°)", desc: "Sun is within 6° below horizon. Enough natural light to see outdoors without streetlights." },
        nautical: { label: "Nautical Twilight (-12°)", desc: "Sun is 6° to 12° below horizon. Horizon is visible at sea; bright stars appear." },
        astronomical: { label: "Astronomical Twilight (-18°)", desc: "Sun is 12° to 18° below horizon. Sky is fully dark; faintest stars are visible." }
    };

    // --- CUSTOM DROPDOWN DIALOG ---
    function showTwilightMenu() {
        if (document.getElementById('gcal-twilight-dialog')) return;

        const overlay = document.createElement('div');
        overlay.id = 'gcal-twilight-dialog';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5); z-index: 99999;
            display: flex; align-items: center; justify-content: center;
            font-family: Roboto, Arial, sans-serif;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #fff; padding: 24px; border-radius: 8px;
            width: 420px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            color: #202124;
        `;

        dialog.innerHTML = `
            <h3 style="margin-top:0; margin-bottom:12px; font-size:18px;">Select Daylight / Twilight Mode</h3>
            <label style="font-weight:bold; font-size:14px; display:block; margin-bottom:6px;">Twilight Type:</label>
            <select id="twilight-select" style="width:100%; padding:8px; font-size:14px; border:1px solid #dadce0; border-radius:4px; margin-bottom:12px;">
                ${Object.keys(TWILIGHT_DEFINITIONS).map(key => `
                    <option value="${key}" ${CONFIG.twilightType === key ? 'selected' : ''}>
                        ${TWILIGHT_DEFINITIONS[key].label}
                    </option>
                `).join('')}
            </select>
            <div id="twilight-desc" style="font-size:13px; color:#5f6368; background:#f1f3f4; padding:10px; border-radius:4px; margin-bottom:16px;">
                ${TWILIGHT_DEFINITIONS[CONFIG.twilightType].desc}
            </div>
            <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button id="twilight-cancel" style="padding:8px 16px; border:none; background:transparent; cursor:pointer; font-weight:500;">Cancel</button>
                <button id="twilight-save" style="padding:8px 16px; border:none; background:#1a73e8; color:#fff; border-radius:4px; cursor:pointer; font-weight:500;">Save & Reload</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const select = dialog.querySelector('#twilight-select');
        const desc = dialog.querySelector('#twilight-desc');

        select.addEventListener('change', (e) => {
            desc.textContent = TWILIGHT_DEFINITIONS[e.target.value].desc;
        });

        dialog.querySelector('#twilight-cancel').addEventListener('click', () => overlay.remove());
        dialog.querySelector('#twilight-save').addEventListener('click', () => {
            setStoredValue('twilight_type', select.value);
            location.reload();
        });
    }

    // --- TAMPERMONKEY MENU COMMANDS ---
    GM_registerMenuCommand(`1. Change Twilight Type (Current: ${CONFIG.twilightType})`, showTwilightMenu);

    GM_registerMenuCommand(`2. Set Timezone (Current: ${CONFIG.userTimezone})`, () => {
        const tz = prompt("Enter IANA Timezone (or leave default for autodetect/Tallinn):", CONFIG.userTimezone);
        if (tz) { setStoredValue('user_tz', tz.trim()); location.reload(); }
    });

    GM_registerMenuCommand(`3. Set Coordinates (Current: ${CONFIG.fallbackLat}, ${CONFIG.fallbackLng})`, () => {
        const lat = prompt("Latitude:", CONFIG.fallbackLat);
        const lng = prompt("Longitude:", CONFIG.fallbackLng);
        if (lat && lng) {
            setStoredValue('user_lat', parseFloat(lat));
            setStoredValue('user_lng', parseFloat(lng));
            location.reload();
        }
    });

    // --- SOLAR MATH ENGINE ---
    const ZENITH_ANGLES = { official: 90.833, civil: 96.0, nautical: 102.0, astronomical: 108.0 };

    function getSolarTimes(date, lat, lng, twilightType) {
        const zenith = ZENITH_ANGLES[twilightType] || ZENITH_ANGLES.civil;
        const startOfYear = new Date(date.getFullYear(), 0, 0);
        const diff = date - startOfYear + ((startOfYear.getTimezoneOffset() - date.getTimezoneOffset()) * 60000);
        const dayOfYear = Math.floor(diff / 86400000);
        const lngHour = lng / 15.0;

        const tRise = dayOfYear + ((6.0 - lngHour) / 24.0);
        const tSet = dayOfYear + ((18.0 - lngHour) / 24.0);

        const riseMin = calculateSunEvent(tRise, lat, lng, zenith, true);
        const setMin = calculateSunEvent(tSet, lat, lng, zenith, false);

        if (isNaN(riseMin) || isNaN(setMin)) return null;
        return { sunriseMinutes: riseMin, sunsetMinutes: setMin };
    }

    function calculateSunEvent(t, lat, lng, zenith, isSunrise) {
        const rad = Math.PI / 180.0, deg = 180.0 / Math.PI;
        const M = (0.985600 * t) - 3.289;
        let L = (M + (1.916 * Math.sin(M * rad)) + (0.020 * Math.sin(2 * M * rad)) + 282.634 + 360) % 360;
        let RA = (deg * Math.atan(0.91764 * Math.tan(L * rad)) + 360) % 360;
        RA = (RA + (Math.floor(L / 90.0) * 90.0 - Math.floor(RA / 90.0) * 90.0)) / 15.0;

        const sinDec = 0.39782 * Math.sin(L * rad);
        const cosDec = Math.cos(Math.asin(sinDec));
        const cosH = (Math.cos(zenith * rad) - (sinDec * Math.sin(lat * rad))) / (cosDec * Math.cos(lat * rad));

        if (cosH > 1 || cosH < -1) return NaN;

        let H = isSunrise ? 360 - deg * Math.acos(cosH) : deg * Math.acos(cosH);
        let UT = (H / 15.0 + RA - (0.06571 * t) - 6.622 - (lng / 15.0) + 24) % 24;
        return UT * 60;
    }

    // --- DATE EXTRACTION FROM GCAL VIEW STATE ---
    function getViewBaseDate() {
        const match = window.location.pathname.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
        if (match) {
            return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
        }
        return new Date();
    }

    function extractDateFromColumn(el, index, totalCols) {
        const attrs = ['data-date', 'data-date-key', 'data-start-date'];
        for (const attr of attrs) {
            const val = el.getAttribute(attr);
            if (val) {
                const ymd = val.match(/\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
                if (ymd) return new Date(parseInt(ymd[1]), parseInt(ymd[2]) - 1, parseInt(ymd[3]));
            }
        }

        const baseDate = getViewBaseDate();
        if (totalCols === 1) return baseDate;

        const date = new Date(baseDate);
        if (totalCols === 7) {
            const dayOffset = index - (date.getDay() === 0 ? 6 : date.getDay() - 1);
            date.setDate(date.getDate() + dayOffset);
        } else {
            date.setDate(date.getDate() + index);
        }
        return date;
    }

    // --- RESILIENT DOM SEARCH ENGINE ---
    function findDayColumns() {
        // Multi-strategy selector query to match current and legacy GCal layouts
        const selectors = [
            '[role="timegrid"] [role="gridcell"]',
            '[role="main"] [role="gridcell"]',
            'div[data-date-key]',
            'div[aria-hidden="true"] + div > div',
            'div[role="presentation"] > div > [role="gridcell"]'
        ];

        for (const sel of selectors) {
            const matches = Array.from(document.querySelectorAll(sel)).filter(el => el.clientHeight > 250);
            if (matches.length > 0) return matches;
        }

        // Fallback: scan high-height vertical columns in main view
        const main = document.querySelector('[role="main"]') || document.body;
        return Array.from(main.querySelectorAll('div')).filter(el => {
            return el.clientHeight > 300 && el.clientWidth > 40 && el.clientWidth < 300 && el.children.length >= 0;
        });
    }

    function applyPerDayGradients() {
        const columns = findDayColumns();
        if (!columns.length) return;

        columns.forEach((col, idx) => {
            const date = extractDateFromColumn(col, idx % 7, Math.min(columns.length, 7));
            if (!date) return;

            const solar = getSolarTimes(date, CONFIG.fallbackLat, CONFIG.fallbackLng, CONFIG.twilightType);
            if (!solar) return;

            const tzOffsetMinutes = -date.getTimezoneOffset();
            const riseLocalMin = solar.sunriseMinutes + tzOffsetMinutes;
            const setLocalMin = solar.sunsetMinutes + tzOffsetMinutes;

            const risePct = Math.max(0, Math.min(100, (riseLocalMin / 1440) * 100)).toFixed(2);
            const setPct = Math.max(0, Math.min(100, (setLocalMin / 1440) * 100)).toFixed(2);

            let overlay = col.querySelector('.gcal-daylight-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'gcal-daylight-overlay';
                overlay.style.cssText = `
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    pointer-events: none;
                    z-index: 0;
                `;
                if (getComputedStyle(col).position === 'static') {
                    col.style.position = 'relative';
                }
                col.insertBefore(overlay, col.firstChild);
            }

            overlay.style.background = `linear-gradient(to bottom,
                transparent 0%,
                transparent ${risePct}%,
                ${CONFIG.daylightColor} ${risePct}%,
                ${CONFIG.daylightColor} ${setPct}%,
                transparent ${setPct}%,
                transparent 100%)`;
        });
    }

    let debounceTimer = null;
    const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(applyPerDayGradients, 150);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    applyPerDayGradients();
})();
