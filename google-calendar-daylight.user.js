// ==UserScript==
// @name         Google Calendar - Daylight Column Highlights
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  CSP-safe CSS injection for GCal daylight highlights.
// @author       Allan
// @match        https://calendar.google.com/calendar/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        fallbackLat: GM_getValue('user_lat', 59.4370),
        fallbackLng: GM_getValue('user_lng', 24.7535),
        twilightType: GM_getValue('twilight_type', 'civil'),
        daylightColor: 'rgba(255, 235, 130, 0.28)'
    };

    GM_registerMenuCommand(`1. Set Twilight Type (Current: ${CONFIG.twilightType})`, () => {
        const type = prompt("Enter Twilight Type:\n- civil (-6°)\n- nautical (-12°)\n- astronomical (-18°)\n- official (0°)", CONFIG.twilightType);
        if (['official', 'civil', 'nautical', 'astronomical'].includes(type?.toLowerCase().trim())) {
            GM_setValue('twilight_type', type.toLowerCase().trim());
            location.reload();
        }
    });

    GM_registerMenuCommand(`2. Set Coordinates (Current: ${CONFIG.fallbackLat}, ${CONFIG.fallbackLng})`, () => {
        const lat = prompt("Latitude:", CONFIG.fallbackLat);
        const lng = prompt("Longitude:", CONFIG.fallbackLng);
        if (lat && lng) {
            GM_setValue('user_lat', parseFloat(lat));
            GM_setValue('user_lng', parseFloat(lng));
            location.reload();
        }
    });

    const ZENITH_ANGLES = { official: 90.833, civil: 96.0, nautical: 102.0, astronomical: 108.0 };

    function getSolarTimes(date, lat, lng, twilightType) {
        const zenith = ZENITH_ANGLES[twilightType] || ZENITH_ANGLES.civil;
        const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
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

    function updateDaylightStyle() {
        const now = new Date();
        const solar = getSolarTimes(now, CONFIG.fallbackLat, CONFIG.fallbackLng, CONFIG.twilightType);
        if (!solar) return;

        const tzOffsetMinutes = -now.getTimezoneOffset();
        const riseLocalMin = solar.sunriseMinutes + tzOffsetMinutes;
        const setLocalMin = solar.sunsetMinutes + tzOffsetMinutes;

        const risePct = Math.max(0, Math.min(100, (riseLocalMin / 1440) * 100)).toFixed(2);
        const setPct = Math.max(0, Math.min(100, (setLocalMin / 1440) * 100)).toFixed(2);

        // Injects standard stylesheet through Tampermonkey GM privilege API (bypasses GCal CSP)
        const css = `
            [role="gridcell"], [role="columnheader"], [data-date-key] {
                background-image: linear-gradient(to bottom,
                    transparent 0%,
                    transparent ${risePct}%,
                    ${CONFIG.daylightColor} ${risePct}%,
                    ${CONFIG.daylightColor} ${setPct}%,
                    transparent ${setPct}%,
                    transparent 100%) !important;
                background-repeat: no-repeat !important;
                background-size: 100% 100% !important;
            }
        `;

        if (typeof GM_addStyle !== 'undefined') {
            GM_addStyle(css);
        } else {
            const style = document.createElement('style');
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
        }
    }

    updateDaylightStyle();
})();