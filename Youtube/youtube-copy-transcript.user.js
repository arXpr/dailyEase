// ==UserScript==
// @name         YouTube Copy Transcript Button
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Adds a button on YouTube watch pages to copy the transcript. Shift+Click copies with timestamps.
// @author       Arya Pratik
// @match        https://www.youtube.com/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ---- SETTINGS ----
    // Language name as shown in the transcript panel dropdown (partial match,
    // case-insensitive). Examples: 'English', 'Hindi', 'Marathi'.
    // Leave '' to keep YouTube's default language.
    const TRANSCRIPT_LANGUAGE = 'English';

    const BTN_ID = 'yt-copy-transcript-btn';
    const IDLE_LABEL = '📋 Copy Transcript';
    const PANEL_SELECTOR =
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Poll until fn() returns something truthy (or timeout)
    async function waitFor(fn, timeout = 4000, interval = 100) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            const v = fn();
            if (v) return v;
            await sleep(interval);
        }
        return null;
    }

    const getSegments = () => {
        const s = document.querySelectorAll('ytd-transcript-segment-renderer');
        return s.length ? s : null;
    };

    const findShowTranscriptBtn = () =>
        document.querySelector('ytd-video-description-transcript-section-renderer button') ||
        Array.from(document.querySelectorAll('button, ytd-button-renderer')).find((el) =>
            /show transcript/i.test(el.textContent || '')
        );

    // Returns { segments, openedByUs }
    async function openTranscript() {
        let segments = getSegments();
        if (segments) return { segments, openedByUs: false };

        let btn = findShowTranscriptBtn();
        if (!btn) {
            // Description collapsed hai -> expand karke dobara try
            document.querySelector('#expand')?.click();
            btn = await waitFor(findShowTranscriptBtn, 1500);
        }
        if (!btn) return { segments: null, openedByUs: false };

        btn.click();
        segments = await waitFor(getSegments, 5000);
        return { segments, openedByUs: true };
    }

    // Switch the transcript panel to the wanted language via its dropdown
    async function selectLanguage(lang) {
        if (!lang) return;
        const want = lang.toLowerCase();
        const footer = document.querySelector(`${PANEL_SELECTOR} ytd-transcript-footer-renderer`);
        if (!footer) return;

        const current = (footer.querySelector('#label-text')?.innerText || '').toLowerCase();
        if (current.includes(want)) return; // already in the right language

        const trigger = footer.querySelector(
            'yt-dropdown-menu tp-yt-paper-button, yt-dropdown-menu button, yt-dropdown-menu #label'
        );
        if (!trigger) return;
        trigger.click();

        const items = await waitFor(() => {
            const a = footer.querySelectorAll('tp-yt-paper-listbox a');
            return a.length ? Array.from(a) : null;
        }, 1500);
        if (!items) return;

        const matches = items.filter((a) => a.innerText.toLowerCase().includes(want));
        // Prefer the human-made transcript over "(auto-generated)"
        const match = matches.find((a) => !/auto/i.test(a.innerText)) || matches[0];

        if (match) {
            match.click();
            await sleep(300);
            await waitFor(getSegments, 3000);
            await sleep(300); // let the new segments finish rendering
        } else {
            trigger.click(); // language not available: close the dropdown
        }
    }

    function closeTranscript() {
        const closeBtn = document.querySelector(`${PANEL_SELECTOR} #visibility-button button`);
        closeBtn?.click();
    }

    function readSegments(segments, withTimestamps) {
        return Array.from(segments)
            .map((seg) => {
                const text = seg.querySelector('.segment-text')?.innerText.trim() || '';
                if (!text) return '';
                if (!withTimestamps) return text;
                const time = seg.querySelector('.segment-timestamp')?.innerText.trim() || '';
                return time ? `[${time}] ${text}` : text;
            })
            .filter(Boolean)
            .join('\n');
    }

    async function copyText(text) {
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(text);
        } else {
            await navigator.clipboard.writeText(text);
        }
    }

    function createButton() {
        const btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.type = 'button';
        btn.innerText = IDLE_LABEL;
        btn.title = 'Click: copy transcript | Shift+Click: copy with timestamps';
        btn.style.cssText = `
            margin-left: 8px;
            padding: 0 16px;
            height: 36px;
            background-color: var(--yt-spec-badge-chip-background, rgba(128,128,128,0.2));
            color: var(--yt-spec-text-primary, currentColor);
            border: none;
            border-radius: 18px;
            font-size: 14px;
            font-weight: 500;
            font-family: inherit;
            cursor: pointer;
            white-space: nowrap;
        `;

        btn.addEventListener('mouseenter', () => (btn.style.filter = 'brightness(1.25)'));
        btn.addEventListener('mouseleave', () => (btn.style.filter = ''));

        let busy = false;
        btn.addEventListener('click', async (e) => {
            if (busy) return;
            busy = true;
            const withTimestamps = e.shiftKey;
            btn.innerText = '⌛ Fetching...';

            try {
                const opened = await openTranscript();
                const openedByUs = opened.openedByUs;
                let segments = opened.segments;
                if (segments) {
                    await selectLanguage(TRANSCRIPT_LANGUAGE);
                    segments = getSegments() || segments; // re-query after language switch
                }
                if (!segments) {
                    btn.innerText = '❌ No Transcript';
                } else {
                    const text = readSegments(segments, withTimestamps);
                    if (text) {
                        await copyText(text);
                        btn.innerText = withTimestamps ? '✅ Copied (with time)' : '✅ Copied!';
                    } else {
                        btn.innerText = '❌ Empty Transcript';
                    }
                    if (openedByUs) closeTranscript();
                }
            } catch (err) {
                console.error('[Copy Transcript] Error:', err);
                btn.innerText = '❌ Error';
            }

            await sleep(2500);
            btn.innerText = IDLE_LABEL;
            busy = false;
        });

        return btn;
    }

    function ensureButton() {
        if (location.pathname !== '/watch') return;
        if (document.getElementById(BTN_ID)) return;

        const container =
            document.querySelector('ytd-watch-metadata #top-level-buttons-computed') ||
            document.querySelector('ytd-watch-metadata #actions-inner') ||
            document.querySelector('ytd-watch-metadata #owner');
        if (!container) return;

        container.appendChild(createButton());
    }

    // Debounced observer: sirf tab chalta hai jab YouTube DOM re-render kare
    let timer = null;
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(ensureButton, 300);
    };

    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

    // YouTube SPA navigation
    window.addEventListener('yt-navigate-finish', schedule);

    ensureButton();
})();
