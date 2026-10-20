const TIGEREST_APPEARANCE_STYLE_ID = 'tigerest-appearance-style';
const TIGEREST_APPEARANCE_OWNER_ATTRIBUTE = 'data-tigerest-owned';
const TIGEREST_APPEARANCE_OWNER = 'web-appearance';
const TIGEREST_PAGE_SELECTOR = '.mainAnimatedPage, .page';
const TIGEREST_PAGE_ENTER_CLASS = 'tigerest-page-enter';
const TIGEREST_PAGE_PENDING_CLASS = 'tigerest-page-pending';
const TIGEREST_TAB_BUTTON_SELECTOR = '.main-tab-button';
const TIGEREST_TAB_CONTENT_SELECTOR = '.tabContent';
const TIGEREST_ARTWORK_SELECTOR = '.detailImageContainer, .cardImageContainer, .primaryImage, img.cardImage, .backdropImage';
// Chromium 143 and later (checked through 155, the Android WebView in use)
// make an element with a backdrop filter a Backdrop Root. QtWebEngine 6.9
// (Chromium 130) still lets a nested backdrop filter see and re-blur the
// page under its glass parent, so its header keeps the nested filters.
const TIGEREST_BACKDROP_ROOTS = +(/Chrome\/(\d+)\./.exec(globalThis.navigator?.userAgent || '')?.[1] || 0) >= 143;
const TIGEREST_FLAT_GLASS = 'data-tigerest-flat-glass';
const tigerestMotionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)') || {matches: false};
let tigerestAmbientImage = '';
let tigerestAmbientPhase = 'b';
const tigerestAmbientLayers = {a: 'none', b: 'none'};
let tigerestAmbientRequest = 0;
let tigerestAmbientGeneration = 0;
let tigerestAmbientPool = [];
let tigerestSuppressPageAnimationUntil = 0;
let tigerestTabTransitionGeneration = 0;
const tigerestPageAnimationTimers = new WeakMap();
const tigerestTabAnimationStates = new WeakMap();

function mountTigerestAppearanceStyles() {
    if (!document.head) return false;

    let style = document.head.querySelector(
        `style[${TIGEREST_APPEARANCE_OWNER_ATTRIBUTE}="${TIGEREST_APPEARANCE_OWNER}"]`,
    );
    if (!style) {
        style = document.createElement('style');
        style.id = TIGEREST_APPEARANCE_STYLE_ID;
        style.setAttribute(TIGEREST_APPEARANCE_OWNER_ATTRIBUTE, TIGEREST_APPEARANCE_OWNER);
        style.textContent = `
            :root {
                --tgs-accent: #ffbe38;
                --tgs-accent-soft: rgba(255, 190, 56, .16);
                --tgs-panel: rgba(20, 23, 31, .72);
                --tgs-panel-strong: rgba(17, 20, 27, .88);
                --tgs-panel-border: rgba(255, 255, 255, .10);
                --tgs-text-soft: rgba(255, 255, 255, .72);
                --tgs-shadow: 0 18px 48px rgba(0, 0, 0, .32);
                --tgs-shadow-soft: 0 10px 30px rgba(0, 0, 0, .22);
                --tgs-radius: 14px;
                --tgs-ease: cubic-bezier(.22, 1, .36, 1);
            }

            html,
            body {
                background-color: #0b0d12 !important;
            }

            body.tigerest-appearance-ready {
                color-scheme: dark;
            }

            /* Chromium ignores custom scrollbar painting when Emby supplies
               a standard scrollbar-color, even though pseudo styles resolve. */
            body.tigerest-appearance-ready,
            body.tigerest-appearance-ready * { scrollbar-color: auto; }
            body.tigerest-appearance-ready :is(.scrollX-mini, .scrollY-mini):not(.hiddenScrollX, .hiddenScrollY) {
                scrollbar-width: auto;
            }

            /* Touch screens keep their own overlay scrollbar: a styled bar is a
               9px lane, which narrowed Emby's scrolling item view on a phone and
               left a strip beside its full-width backdrop. */
            @media not all and (pointer: coarse) {
            body.tigerest-appearance-ready::-webkit-scrollbar,
            body.tigerest-appearance-ready ::-webkit-scrollbar { width: 9px; height: 9px; }
            body.tigerest-appearance-ready::-webkit-scrollbar-track,
            body.tigerest-appearance-ready ::-webkit-scrollbar-track { background: transparent; }
            body.tigerest-appearance-ready::-webkit-scrollbar-thumb,
            body.tigerest-appearance-ready ::-webkit-scrollbar-thumb {
                min-height: 42px;
                background: rgba(220, 226, 238, .28);
                border: 2px solid transparent;
                border-radius: 999px;
                background-clip: padding-box;
            }
            body.tigerest-appearance-ready::-webkit-scrollbar-thumb:hover,
            body.tigerest-appearance-ready ::-webkit-scrollbar-thumb:hover {
                background-color: rgba(220, 226, 238, .48);
            }
            body.tigerest-appearance-ready::-webkit-scrollbar-button,
            body.tigerest-appearance-ready ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
            body.tigerest-appearance-ready::-webkit-scrollbar-corner,
            body.tigerest-appearance-ready ::-webkit-scrollbar-corner { background: transparent; }
            }
            /* Tab strips are swiped on a touch screen; they show no bar at all. */
            @media (pointer: coarse) {
                body.tigerest-appearance-ready .emby-tabs { scrollbar-width: none; }
                body.tigerest-appearance-ready .emby-tabs::-webkit-scrollbar { display: none; width: 0; height: 0; }
            }
            /* Below 50em Emby crops the item's artwork into a 40vh band whose top
               lies under the opaque header; an episode's 16:9 image lost its upper
               third. Show the whole 16:9 image below the header instead. The poster
               flight lands on it, since this layout hides the episode's own image. */
            @media (max-width: 49.99em) {
                body.tigerest-appearance-ready .itemBackdropContainer:not(.itemBackdropContainer-small) {
                    height: min(calc(var(--header-height, 0px) + 56.25vw), 62vh);
                }
                body.tigerest-appearance-ready .itemBackdropContainer > .itemBackdrop { top: var(--header-height, 0px); }
            }

            .cardOverlayFab-primary:is([data-action="play"], [data-action="resume"], [data-action="playallfromhere"]) {
                display: none !important;
            }

            .detailSelectSeasonContainer { padding-bottom: 22px !important; }

            .emby-scrollbuttons-scrollbutton {
                box-sizing: border-box;
                width: 40px !important; height: 40px !important;
                color: rgba(255, 255, 255, .92) !important;
                background: rgba(17, 20, 27, .78) !important;
                border: 1px solid rgba(255, 255, 255, .18) !important;
                border-radius: 12px !important;
                box-shadow: 0 4px 16px rgba(0, 0, 0, .24) !important;
                backdrop-filter: blur(12px);
                transition: background 160ms ease, border-color 160ms ease;
            }
            .emby-scrollbuttons-scrollbutton:hover,
            .emby-scrollbuttons-scrollbutton:focus-visible {
                color: var(--tgs-accent) !important;
                background: rgba(17, 20, 27, .96) !important;
                border-color: rgba(255, 190, 56, .5) !important;
            }
            .emby-scrollbuttons-scrollbutton .md-icon { font-size: 26px !important; }

            .backgroundContainer {
                --tgs-ambient-image-a: none;
                --tgs-ambient-image-b: none;
                position: fixed;
                overflow: hidden;
                background-color: #0b0d12 !important;
                background-image: none !important;
                isolation: isolate;
            }

            .backgroundContainer::before,
            .backgroundContainer::after {
                content: '';
                position: absolute;
                z-index: 0;
                top: -12%;
                right: -12%;
                bottom: -12%;
                left: -12%;
                background-image:
                    linear-gradient(180deg, rgba(7, 10, 16, .32), rgba(8, 11, 17, .58)),
                    var(--tgs-ambient-image-a),
                    radial-gradient(circle at 10% -10%, rgba(255, 190, 56, .08), transparent 32rem),
                    radial-gradient(circle at 90% 12%, rgba(67, 133, 255, .18), transparent 38rem),
                    linear-gradient(145deg, #111927 0%, #17263b 54%, #11151d 100%);
                background-position: center;
                background-size: cover;
                filter: blur(58px) saturate(1.42) brightness(.78);
                transform: scale(1.16);
                opacity: .92;
                transition: opacity 850ms var(--tgs-ease), filter 850ms ease, transform 850ms var(--tgs-ease);
            }

            .backgroundContainer::after {
                background-image:
                    linear-gradient(180deg, rgba(7, 10, 16, .32), rgba(8, 11, 17, .58)),
                    var(--tgs-ambient-image-b),
                    radial-gradient(circle at 88% -8%, rgba(255, 190, 56, .07), transparent 32rem),
                    radial-gradient(circle at 12% 16%, rgba(67, 133, 255, .18), transparent 38rem),
                    linear-gradient(215deg, #111927 0%, #17263b 54%, #11151d 100%);
                opacity: 0;
            }

            html.tigerest-ambient-phase-b .backgroundContainer::before {
                opacity: 0;
                transform: scale(1.19);
            }

            html.tigerest-ambient-phase-b .backgroundContainer::after {
                opacity: .92;
                transform: scale(1.16);
            }

            .backgroundContainer.withBackdrop {
                background-color: transparent !important;
                background-image: none !important;
            }

            .backdropImage {
                transform: scale(1.015);
                filter: saturate(.92) contrast(1.03);
                animation: tigerestBackdropEnter 420ms var(--tgs-ease) both;
            }

            .skinHeader,
            .skinHeader-withBackground,
            .headerTop {
                background: rgba(13, 16, 22, .52) !important;
                border-bottom: 1px solid rgba(255, 255, 255, .075);
                box-shadow: 0 8px 28px rgba(0, 0, 0, .16);
            }

            .skinHeader.semiTransparent,
            .skinHeader-withBackground.semiTransparent {
                background: rgba(13, 16, 22, .44) !important;
            }

            @media (pointer: fine) {
                /* Emby reserves 1.08em for an embedded scrollbar. Match our 9px
                   bar and paint through its lane without covering its hit area. */
                body.tigerest-appearance-ready .skinHeader.adjustHeaderForEmbeddedScroll {
                    right: 9px;
                    inset-inline-end: 9px;
                    --tgs-header-edge: 9px;
                    --tgs-header-edge-color: rgba(13, 16, 22, .52);
                    box-shadow: var(--tgs-header-edge) 0 0 var(--tgs-header-edge-color),
                        0 8px 28px rgba(0, 0, 0, .16) !important;
                }
                body.tigerest-appearance-ready .skinHeader.adjustHeaderForEmbeddedScroll.semiTransparent {
                    --tgs-header-edge-color: rgba(13, 16, 22, .44);
                }
                [dir="rtl"] body.tigerest-appearance-ready .skinHeader.adjustHeaderForEmbeddedScroll {
                    right: 0;
                    --tgs-header-edge: -9px;
                }
            }

            .headerTabs,
            .emby-tabs-slider {
                background: transparent !important;
            }

            .emby-tab-button {
                position: relative;
                opacity: .72;
                transition: color 180ms ease, opacity 180ms ease, transform 180ms var(--tgs-ease);
            }

            .emby-tab-button:hover,
            .emby-tab-button:focus,
            .emby-tab-button-active {
                opacity: 1;
                transform: translateY(-1px);
            }

            .emby-tab-button:focus-visible {
                opacity: 1;
                transform: translateY(-1px);
            }

            .emby-tab-button-active {
                color: #fff !important;
            }

            .emby-tab-button-active::after {
                content: '';
                position: absolute;
                right: 22%;
                bottom: .18em;
                left: 22%;
                height: 2px;
                border-radius: 999px;
                background: var(--tgs-accent);
                box-shadow: 0 0 14px rgba(255, 190, 56, .44);
            }

            .dialog,
            .promptDialog,
            .actionSheet,
            .toast,
            .paperList,
            .formDialogHeader,
            .formDialogFooter {
                border: 1px solid var(--tgs-panel-border) !important;
                background: var(--tgs-panel-strong) !important;
                box-shadow: var(--tgs-shadow) !important;
            }

            .dialog,
            .promptDialog,
            .actionSheet,
            .paperList {
                border-radius: var(--tgs-radius) !important;
            }

            .toast {
                border-radius: 999px !important;
                padding-right: 1.2em !important;
                padding-left: 1.2em !important;
            }

            .formDialogHeader {
                border-bottom: 1px solid rgba(255, 255, 255, .08) !important;
            }

            .formDialogFooter {
                border-top: 1px solid rgba(255, 255, 255, .08) !important;
            }

            /* Emby left-aligns form columns beside a docked drawer, which
               leaves most of a wide window empty; center them instead. */
            body.tigerest-appearance-ready .page-withDockedDrawer :is(.readOnlyContent, form).auto-center {
                margin-inline: auto;
            }

            .detailRibbon,
            .detailPagePrimaryContainer {
                background-color: rgba(12, 15, 21, .28) !important;
                border-color: rgba(255, 255, 255, .07) !important;
            }

            .detailMainContainer {
                padding-top: 24px !important;
                padding-bottom: 18px !important;
            }

            .detailTextContainer {
                padding-top: 6px !important;
            }

            .detailNameContainer {
                margin-bottom: 10px !important;
            }

            .detail-mediaInfoPrimary {
                margin-bottom: 4px !important;
            }

            .mainDetailButtons {
                margin-top: 14px !important;
                margin-bottom: 14px !important;
            }

            .overview-container {
                margin-top: 10px !important;
            }

            .card {
                contain: inline-size layout style !important;
            }

            .portraitCard .cardBox,
            .backdropCard .cardBox,
            .squareCard .cardBox,
            .visualCardBox {
                border-radius: 16px;
                background: transparent !important;
                box-shadow: none !important;
                transition:
                    transform 420ms var(--tgs-ease),
                    filter 360ms ease;
            }

            .cardImageContainer,
            .cardContent-button,
            .cardOverlayContainer {
                border-radius: 16px !important;
            }

            /* Jellyfin's default theme paints the placeholder and blurred preview
               under the artwork with small corners; matching them keeps the dark
               corners from showing outside the rounded poster. */
            .cardPadder,
            .blurhash-canvas {
                border-radius: 16px !important;
            }

            .cardImageContainer {
                overflow: hidden;
                box-shadow: 0 8px 24px rgba(0, 0, 0, .24);
                transition: box-shadow 420ms var(--tgs-ease), filter 360ms ease;
            }

            .cardImageContainer::after {
                content: '';
                position: absolute;
                top: 0;
                right: 0;
                bottom: 0;
                left: 0;
                pointer-events: none;
                border: 1px solid rgba(255, 255, 255, .09);
                border-radius: inherit;
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, .07);
            }

            .portraitCard:hover .cardBox,
            .portraitCard:focus-visible .cardBox,
            .portraitCard:has(:focus-visible) .cardBox,
            .backdropCard:hover .cardBox,
            .backdropCard:focus-visible .cardBox,
            .backdropCard:has(:focus-visible) .cardBox,
            .squareCard:hover .cardBox,
            .squareCard:focus-visible .cardBox,
            .squareCard:has(:focus-visible) .cardBox {
                transform: translateY(-12px) scale(1.04);
                filter: brightness(1.07) saturate(1.06);
                box-shadow: none !important;
            }

            .card:hover .cardImageContainer,
            .card:focus-visible .cardImageContainer,
            .card:has(:focus-visible) .cardImageContainer {
                box-shadow:
                    0 24px 54px rgba(0, 0, 0, .46),
                    0 0 28px rgba(91, 151, 255, .20),
                    0 0 0 1px rgba(255, 255, 255, .10);
            }

            .card:hover,
            .card:focus-visible,
            .card:has(:focus-visible) {
                z-index: 3;
            }

            .cardText,
            .cardTextCentered,
            .cardFooter {
                background: transparent !important;
                box-shadow: none !important;
            }

            .listItem {
                border-radius: 11px;
                transition: background-color 160ms ease, transform 180ms var(--tgs-ease);
            }

            .listItem:hover,
            .listItem:focus-within {
                background-color: rgba(255, 255, 255, .055) !important;
                transform: translateX(2px);
            }

            .mainDrawer {
                background: rgba(15, 19, 27, .66) !important;
                border-right: 1px solid rgba(255, 255, 255, .11);
                box-shadow: 18px 0 54px rgba(0, 0, 0, .36) !important;
            }

            .mainDrawer .navDrawerListItem {
                margin-right: .65em;
                margin-left: .65em;
                border: 1px solid transparent;
                border-radius: 12px;
                transition: background-color 220ms ease, border-color 220ms ease, transform 300ms var(--tgs-ease);
            }

            .mainDrawer .navDrawerListItem:hover,
            .mainDrawer .navDrawerListItem:focus-within {
                background: rgba(255, 255, 255, .075) !important;
                border-color: rgba(255, 255, 255, .07);
                transform: translateX(6px);
            }

            .mainDrawer .navDrawerListItem.navMenuOption-selected {
                background: rgba(73, 154, 91, .40) !important;
                border-color: rgba(143, 221, 155, .20);
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, .08);
            }

            .raised,
            .button-submit,
            .fab {
                border-radius: 11px !important;
                box-shadow: 0 8px 22px rgba(0, 0, 0, .22);
                transition: transform 160ms var(--tgs-ease), box-shadow 160ms ease, filter 160ms ease;
            }

            .raised:hover,
            .button-submit:hover,
            .fab:hover {
                transform: translateY(-1px);
                filter: brightness(1.05);
                box-shadow: 0 11px 28px rgba(0, 0, 0, .28);
            }

            .paper-icon-button-light,
            .headerButton {
                transition: color 150ms ease, background-color 150ms ease, transform 180ms var(--tgs-ease);
            }

            .paper-icon-button-light:hover,
            .headerButton:hover {
                background-color: rgba(255, 255, 255, .075) !important;
                transform: scale(1.045);
            }

            .emby-input,
            .emby-textarea,
            .emby-select-withcolor,
            .selectArrowContainer {
                border-color: rgba(255, 255, 255, .14) !important;
                border-radius: 10px !important;
                background-color: rgba(255, 255, 255, .055) !important;
                transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
            }

            .emby-input:focus,
            .emby-textarea:focus,
            .emby-select-withcolor:focus {
                border-color: rgba(255, 190, 56, .70) !important;
                background-color: rgba(255, 255, 255, .075) !important;
                box-shadow: 0 0 0 3px var(--tgs-accent-soft) !important;
            }

            :focus-visible {
                outline-color: var(--tgs-accent) !important;
            }

            .tigerest-page-enter {
                visibility: visible !important;
                animation: tigerestPageEnter 620ms var(--tgs-ease) 80ms both !important;
                transform-origin: 50% 42%;
                will-change: opacity, filter, transform;
            }

            .tigerest-page-pending {
                visibility: hidden !important;
                opacity: 0 !important;
                filter: blur(12px);
                clip-path: inset(7% 0 0 0 round 18px);
            }

            .tigerest-tab-enter-forward,
            .tigerest-tab-enter-backward {
                transform-origin: center;
                will-change: opacity, filter, transform;
            }

            .tigerest-tab-enter-forward {
                animation: tigerestTabEnterForward 520ms var(--tgs-ease) both !important;
            }

            .tigerest-tab-enter-backward {
                animation: tigerestTabEnterBackward 520ms var(--tgs-ease) both !important;
            }

            @keyframes tigerestPageEnter {
                0% {
                    opacity: .08;
                    filter: blur(12px);
                    clip-path: inset(7% 0 0 0 round 18px);
                    transform: translate3d(0, 72px, 0);
                }
                72% {
                    opacity: 1;
                    filter: blur(0);
                    clip-path: inset(0 0 0 0 round 0);
                    transform: translate3d(0, -9px, 0);
                }
                100% {
                    opacity: 1;
                    filter: blur(0);
                    clip-path: inset(0 0 0 0 round 0);
                    transform: translate3d(0, 0, 0);
                }
            }

            @keyframes tigerestTabEnterForward {
                0% { opacity: .06; filter: blur(11px); transform: translate3d(120px, 0, 0) scale(.94); }
                72% { opacity: 1; filter: blur(0); transform: translate3d(-13px, 0, 0) scale(1.012); }
                100% { opacity: 1; filter: blur(0); transform: translate3d(0, 0, 0) scale(1); }
            }

            @keyframes tigerestTabEnterBackward {
                0% { opacity: .06; filter: blur(11px); transform: translate3d(-120px, 0, 0) scale(.94); }
                72% { opacity: 1; filter: blur(0); transform: translate3d(13px, 0, 0) scale(1.012); }
                100% { opacity: 1; filter: blur(0); transform: translate3d(0, 0, 0) scale(1); }
            }

            @keyframes tigerestBackdropEnter {
                from { opacity: .45; transform: scale(1.035); }
                to { opacity: 1; transform: scale(1.015); }
            }

            @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
                .skinHeader,
                .skinHeader-withBackground,
                .headerTop,
                .dialog,
                .promptDialog,
                .actionSheet,
                .toast,
                .paperList,
                .formDialogHeader,
                .formDialogFooter,
                .detailRibbon,
                .mainDrawer {
                    -webkit-backdrop-filter: blur(20px) saturate(1.32);
                    backdrop-filter: blur(20px) saturate(1.32);
                }

                .mainDrawer {
                    -webkit-backdrop-filter: blur(28px) saturate(1.38);
                    backdrop-filter: blur(28px) saturate(1.38);
                }
${TIGEREST_BACKDROP_ROOTS ? `
                /* See flattenTigerestHeaderGlass(). Hovered, pressed and
                   focused controls keep their real filter, so states stay
                   exact; the colour is recomputed when they leave it. */
                .skinHeader [${TIGEREST_FLAT_GLASS}]:not(:hover):not(:focus-visible):not(:active) {
                    -webkit-backdrop-filter: none !important;
                    backdrop-filter: none !important;
                    background-color: var(--tigerest-flat-glass-bg) !important;
                }
` : ''}
                .dialog,
                .promptDialog,
                .actionSheet,
                .toast,
                .paperList {
                    background: var(--tgs-panel) !important;
                }
            }

            @media (prefers-reduced-motion: reduce) {
                .emby-tab-button,
                .cardBox,
                .cardImageContainer,
                .listItem,
                .mainDrawer .navDrawerListItem,
                .raised,
                .button-submit,
                .fab,
                .paper-icon-button-light,
                .headerButton,
                .emby-input,
                .emby-textarea,
                .emby-select-withcolor,
                .selectArrowContainer {
                    transition-duration: .01ms !important;
                }

                .backgroundContainer::before,
                .backgroundContainer::after {
                    transform: none !important;
                    transition: none !important;
                }

                .tigerest-page-enter,
                .tigerest-tab-enter-forward,
                .tigerest-tab-enter-backward,
                .backdropImage {
                    animation: none !important;
                    transform: none !important;
                }

                .tigerest-page-pending {
                    visibility: visible !important;
                    opacity: 1 !important;
                    filter: none !important;
                    clip-path: none !important;
                }
            }
        `;
    }

    if (document.head.lastElementChild !== style) document.head.appendChild(style);

    document.body?.classList.add('tigerest-appearance-ready');
    return true;
}

function findTigerestPage(start) {
    if (start?.matches?.(TIGEREST_PAGE_SELECTOR)) return start;
    return start?.closest?.(TIGEREST_PAGE_SELECTOR) || null;
}

function tigerestSharedTransitionBusy() {
    // Appearance runs in Qt's ApplicationWorld; transitions run in MainWorld.
    // The DOM flag is shared between them, unlike window properties.
    return document.body?.classList.contains('tigerest-motion-busy')
        || window.TigerestHomeTransitions?.busy;
}

function animateTigerestPage(page) {
    if (!page) return;
    page.classList.remove(TIGEREST_PAGE_PENDING_CLASS);
    if (tigerestSharedTransitionBusy() || tigerestMotionPreference.matches
        || Date.now() < tigerestSuppressPageAnimationUntil
        || page.classList.contains(TIGEREST_PAGE_ENTER_CLASS)) return;

    page.classList.add(TIGEREST_PAGE_ENTER_CLASS);
    let cleanupTimer = 0;
    function cleanup() {
        if (cleanupTimer) clearTimeout(cleanupTimer);
        cleanupTimer = 0;
        page.removeEventListener('animationend', onAnimationEnd);
        page.classList.remove(TIGEREST_PAGE_PENDING_CLASS);
        page.classList.remove(TIGEREST_PAGE_ENTER_CLASS);
    }
    function onAnimationEnd(event) {
        if (event.target === page && event.animationName === 'tigerestPageEnter') cleanup();
    }
    page.addEventListener('animationend', onAnimationEnd);
    cleanupTimer = setTimeout(cleanup, 820);
}

function scheduleTigerestPageAnimation(page) {
    if (!page) return;
    if (tigerestSharedTransitionBusy() || tigerestMotionPreference.matches
        || Date.now() < tigerestSuppressPageAnimationUntil
        || page.classList.contains(TIGEREST_PAGE_ENTER_CLASS)) {
        page.classList.remove(TIGEREST_PAGE_PENDING_CLASS);
        return;
    }

    page.classList.add(TIGEREST_PAGE_PENDING_CLASS);
    const pending = tigerestPageAnimationTimers.get(page);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => {
        tigerestPageAnimationTimers.delete(page);
        if (!page.classList.contains('hide')) animateTigerestPage(page);
        else page.classList.remove(TIGEREST_PAGE_PENDING_CLASS);
    }, 180);
    tigerestPageAnimationTimers.set(page, timer);
}

function tigerestArtworkImage(element) {
    const backgroundImage = getComputedStyle(element).backgroundImage;
    if (backgroundImage && backgroundImage !== 'none') return backgroundImage;

    const source = element.currentSrc || element.src;
    return source ? `url(${JSON.stringify(source)})` : '';
}

function tigerestArtworkUrl(image) {
    const match = /url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/.exec(image || '');
    return match ? (match[1] || match[2] || match[3] || '').trim() : '';
}

function restoreTigerestAmbient(background) {
    if (tigerestAmbientLayers.a === 'none' && tigerestAmbientLayers.b === 'none') return;
    // These inherited values belong only to the background and its pseudo layers.
    // Setting them on html also invalidates every card and hidden page.
    for (const slot of ['a', 'b']) {
        const property = `--tgs-ambient-image-${slot}`;
        if (background.style.getPropertyValue(property) !== tigerestAmbientLayers[slot]) {
            background.style.setProperty(property, tigerestAmbientLayers[slot]);
        }
    }
}

function applyTigerestAmbient(image, request, generation) {
    if (request !== tigerestAmbientRequest || generation !== tigerestAmbientGeneration) return;

    tigerestAmbientPhase = tigerestAmbientPhase === 'a' ? 'b' : 'a';
    tigerestAmbientLayers[tigerestAmbientPhase] = image;
    document.querySelectorAll('.backgroundContainer').forEach(restoreTigerestAmbient);
    // Keep the phase on html so replacement layers start at the correct opacity.
    // Unlike image properties, this selector only targets the background.
    const root = document.documentElement;
    if (tigerestAmbientPhase === 'b') root.classList.add('tigerest-ambient-phase-b');
    else root.classList.remove('tigerest-ambient-phase-b');
    tigerestAmbientImage = image;
}

function preloadTigerestAmbient(image, request, generation) {
    const source = tigerestArtworkUrl(image);
    if (!source || typeof Image !== 'function') {
        applyTigerestAmbient(image, request, generation);
        return;
    }

    const loader = new Image();
    let settled = false;
    let timeoutTimer = 0;
    const succeed = () => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        applyTigerestAmbient(image, request, generation);
    };
    const fail = () => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (request === tigerestAmbientRequest && generation === tigerestAmbientGeneration) {
            tigerestAmbientPool = tigerestAmbientPool.filter(candidate => candidate !== image);
        }
    };
    loader.onload = succeed;
    loader.onerror = fail;
    timeoutTimer = setTimeout(fail, 900);
    loader.src = source;
}

function updateTigerestAmbient(root, generation) {
    if (generation === undefined) generation = ++tigerestAmbientGeneration;
    if (generation !== tigerestAmbientGeneration) return false;

    const candidates = [];
    if (root?.matches?.(TIGEREST_ARTWORK_SELECTOR)) candidates.push(root);
    candidates.push(...(root?.querySelectorAll?.(TIGEREST_ARTWORK_SELECTOR) || []));

    const images = [];
    for (const candidate of candidates) {
        const image = tigerestArtworkImage(candidate);
        if (image && !images.includes(image)) images.push(image);
    }
    for (const image of images) {
        if (!tigerestAmbientPool.includes(image)) tigerestAmbientPool.push(image);
    }
    if (tigerestAmbientPool.length > 48) tigerestAmbientPool = tigerestAmbientPool.slice(-48);
    if (!tigerestAmbientPool.length) return false;

    const choices = [...images, ...tigerestAmbientPool];
    const image = choices.find(candidate => candidate !== tigerestAmbientImage) || choices[0];
    const request = ++tigerestAmbientRequest;
    preloadTigerestAmbient(image, request, generation);
    return true;
}

function scheduleTigerestAmbient(root) {
    const generation = ++tigerestAmbientGeneration;
    let attempts = 0;
    const tryUpdate = () => {
        if (generation !== tigerestAmbientGeneration) return;
        if (updateTigerestAmbient(root, generation)) return;
        attempts += 1;
        if (attempts < 10) setTimeout(tryUpdate, 160);
    };
    setTimeout(tryUpdate, 40);
}

function currentTigerestPage() {
    return [...document.querySelectorAll(TIGEREST_PAGE_SELECTOR)]
        .find(page => !page.classList.contains('hide')) || null;
}

function animateTigerestTab(content, direction) {
    if (tigerestMotionPreference.matches || !content) return;

    tigerestTabAnimationStates.get(content)?.cleanup();
    const className = direction > 0 ? 'tigerest-tab-enter-forward' : 'tigerest-tab-enter-backward';
    const animationName = direction > 0 ? 'tigerestTabEnterForward' : 'tigerestTabEnterBackward';
    content.classList.remove('tigerest-tab-enter-forward', 'tigerest-tab-enter-backward');
    void content.offsetWidth;
    content.classList.add(className);

    let cleanupTimer = 0;
    let finished = false;
    function cleanup() {
        if (finished) return;
        finished = true;
        if (cleanupTimer) clearTimeout(cleanupTimer);
        cleanupTimer = 0;
        content.removeEventListener('animationend', onAnimationEnd);
        content.classList.remove(className);
        if (tigerestTabAnimationStates.get(content)?.cleanup === cleanup) {
            tigerestTabAnimationStates.delete(content);
        }
    }
    function onAnimationEnd(event) {
        if (event.target === content && event.animationName === animationName) cleanup();
    }
    content.addEventListener('animationend', onAnimationEnd);
    cleanupTimer = setTimeout(cleanup, 720);
    tigerestTabAnimationStates.set(content, {cleanup});
}

function handleTigerestTabClick(event) {
    const target = event.target?.closest?.(TIGEREST_TAB_BUTTON_SELECTOR);
    const slider = target?.closest?.('.tabs-viewmenubar-slider');
    if (!target || !slider) return;

    const buttons = [...slider.querySelectorAll(TIGEREST_TAB_BUTTON_SELECTOR)];
    const sourceIndex = buttons.findIndex(button => button.classList.contains('emby-tab-button-active'));
    const targetIndex = buttons.indexOf(target);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

    const direction = targetIndex > sourceIndex ? 1 : -1;
    const originalPage = currentTigerestPage();
    const generation = ++tigerestTabTransitionGeneration;
    tigerestSuppressPageAnimationUntil = Date.now() + 900;

    let attempts = 0;
    const finishSwitch = () => {
        if (generation !== tigerestTabTransitionGeneration) return;
        const activeIndex = buttons.findIndex(button => button.classList.contains('emby-tab-button-active'));
        if (activeIndex !== targetIndex && attempts++ < 8) {
            setTimeout(finishSwitch, 45);
            return;
        }
        if (activeIndex !== targetIndex) return;

        const page = originalPage && !originalPage.classList.contains('hide')
            ? originalPage
            : currentTigerestPage();
        const contents = [...(page?.children || [])]
            .filter(candidate => candidate.matches?.(TIGEREST_TAB_CONTENT_SELECTOR));
        const content = contents.find(candidate => candidate.classList.contains('is-active'))
            || contents[targetIndex];
        animateTigerestTab(content, direction);
        scheduleTigerestAmbient(content || page || document);
    };
    setTimeout(finishSwitch, 32);
}

function observeTigerestPages() {
    if (!document.documentElement) return;

    const observer = new MutationObserver(records => {
        let appearanceHeadChanged = false;
        for (const record of records) {
            if (record.type === 'childList' && record.target === document.head) {
                appearanceHeadChanged = true;
            }
            if (record.type === 'attributes') {
                if (record.target.matches?.('.backgroundContainer')) restoreTigerestAmbient(record.target);
                if (!record.target.matches?.(TIGEREST_PAGE_SELECTOR)) continue;
                const currentClasses = record.target.classList;
                const wasHidden = /(^|\s)hide(\s|$)/.test(record.oldValue || '');
                if (wasHidden && !currentClasses.contains('hide')) {
                    scheduleTigerestPageAnimation(record.target);
                    scheduleTigerestAmbient(record.target);
                }
                continue;
            }

            for (const node of record.addedNodes || []) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (node.matches?.('.backgroundContainer')) restoreTigerestAmbient(node);
                node.querySelectorAll?.('.backgroundContainer').forEach(restoreTigerestAmbient);
                const page = node.matches?.(TIGEREST_PAGE_SELECTOR) ? node : null;
                if (page && !page.classList.contains('hide')) {
                    scheduleTigerestPageAnimation(page);
                    scheduleTigerestAmbient(page);
                }
                for (const child of node.querySelectorAll?.(TIGEREST_PAGE_SELECTOR) || []) {
                    if (!child.classList.contains('hide')) {
                        scheduleTigerestPageAnimation(child);
                        scheduleTigerestAmbient(child);
                    }
                }
            }
        }
        if (appearanceHeadChanged) mountTigerestAppearanceStyles();
    });
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
        attributeOldValue: true,
        childList: true,
        subtree: true,
    });
}

function tigerestColor(value) {
    const match = /^rgba?\(([^)]*)\)$/.exec(value || '');
    const parts = match ? match[1].split(/[\s,/]+/).filter(Boolean).map(Number) : [];
    if (parts.length < 3 || parts.length > 4 || parts.some(Number.isNaN)) return null;
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

function tigerestOver(top, bottom) {
    const alpha = top[3] + bottom[3] * (1 - top[3]);
    if (!alpha) return [0, 0, 0, 0];
    return [0, 1, 2].map(i => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha).concat(alpha);
}

// A running transition reports its current frame; the page states its end.
function tigerestSettledValue(style, property, animations) {
    const key = property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    for (const animation of animations) {
        if (animation.transitionProperty !== property) continue;
        const end = animation.effect?.getKeyframes?.().at(-1)?.[key];
        if (end) return end;
    }
    return style[key];
}

// The backdrop filter applied to a uniform colour. Blur leaves it unchanged;
// any function not modelled here keeps the element's real filter.
function tigerestFilteredColor(filter, color) {
    let [r, g, b, a] = color;
    for (const [, name, argument] of filter.matchAll(/([a-z-]+)\(([^)]*)\)/g)) {
        if (name === 'blur') continue;
        const amount = argument.trim() === '' ? 1 : parseFloat(argument) / (argument.trim().endsWith('%') ? 100 : 1);
        if (!Number.isFinite(amount)) return null;
        if (name === 'saturate') {
            const s = amount;
            [r, g, b] = [
                (.213 + .787 * s) * r + (.715 - .715 * s) * g + (.072 - .072 * s) * b,
                (.213 - .213 * s) * r + (.715 + .285 * s) * g + (.072 - .072 * s) * b,
                (.213 - .213 * s) * r + (.715 - .715 * s) * g + (.072 + .928 * s) * b,
            ];
        } else if (name === 'brightness') [r, g, b] = [r * amount, g * amount, b * amount];
        else if (name === 'opacity') a *= Math.min(1, amount);
        else return null;
        [r, g, b] = [r, g, b].map(v => Math.min(255, Math.max(0, v)));
    }
    return [r, g, b, a];
}

// Chromium stops drawing a button's native look once the page sets its
// background or border, and the control paints from its CSS alone (Jellyfin's
// header buttons keep `appearance: auto` this way). Compare with an untouched
// control of the same kind and colour scheme, which page styles cannot reach.
let tigerestControlProbe = null;
const TIGEREST_CONTROL_LOOK = ['background-color', 'background-image',
    ...['top', 'right', 'bottom', 'left'].flatMap(side => ['style', 'width', 'color'].map(part => `border-${side}-${part}`))];
function tigerestSkinnedControl(node, style) {
    if (['none', ''].includes(style.appearance)) return true;
    const button = node.localName === 'button' || node.localName === 'input' && ['button', 'submit', 'reset'].includes(node.type);
    if (!button || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') return false;
    if (!tigerestControlProbe?.host.isConnected) {
        const host = document.createElement('tigerest-control-probe');
        host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;contain:strict';
        tigerestControlProbe = {host, shadow: host.attachShadow({mode: 'closed'}), looks: new Map()};
        document.documentElement.append(host);
    }
    const key = [node.localName, node.type || '', style.colorScheme].join('|');
    let look = tigerestControlProbe.looks.get(key);
    if (!look) {
        const probe = document.createElement(node.localName);
        if (node.localName === 'input') probe.type = node.type;
        probe.style.colorScheme = style.colorScheme;
        tigerestControlProbe.shadow.replaceChildren(probe);
        const unstyled = getComputedStyle(probe);
        look = TIGEREST_CONTROL_LOOK.map(property => unstyled.getPropertyValue(property));
        tigerestControlProbe.shadow.replaceChildren();
        tigerestControlProbe.looks.set(key, look);
    }
    return TIGEREST_CONTROL_LOOK.some((property, index) => style.getPropertyValue(property) !== look[index]);
}

// In Chromium an element with a backdrop filter is a Backdrop Root. The
// header's own glass therefore hides the page from every backdrop filter
// inside it (ours on .headerTop, themes' on buttons, titles and tabs): each
// only re-filters the flat translucent background its root holds and lays
// that colour under itself, yet costs a filter pass on every scrolled frame.
// Paint that colour directly instead. Anything not provably one colour
// (patterned or shadowed backgrounds, painted pseudo-elements, unmodelled
// filters, native-looking controls, a control in a hover, press or focus
// state) keeps its real filter.
function flattenTigerestHeaderGlass() {
    if (!TIGEREST_BACKDROP_ROOTS) return;
    const settled = node => !node.matches(':hover,:focus-visible,:active');
    for (const header of document.querySelectorAll('.skinHeader')) {
        const nodes = [...header.querySelectorAll('*')];
        // Read every filter and background as the page states them.
        for (const node of nodes) node.removeAttribute(TIGEREST_FLAT_GLASS);
        const styles = new Map([header, ...nodes].map(node => [node, getComputedStyle(node)]));
        // getAnimations flushes pending animation/style state. Each node's
        // list is stable throughout this read-only pass; reuse it for all
        // properties instead of flushing again for every ancestor lookup.
        const animations = new Map();
        const value = (node, property) => {
            if (!animations.has(node)) animations.set(node, node.getAnimations?.() || []);
            return tigerestSettledValue(styles.get(node), property, animations.get(node));
        };
        if (value(header, 'backdrop-filter') === 'none') continue;
        // Each Backdrop Root trigger ends what a descendant's filter sees.
        const isolates = node => {
            const style = styles.get(node);
            return node === header || value(node, 'backdrop-filter') !== 'none' || value(node, 'filter') !== 'none' ||
                +value(node, 'opacity') < 1 || style.maskImage !== 'none' || (style.webkitMaskImage || 'none') !== 'none' ||
                style.clipPath !== 'none' || style.mixBlendMode !== 'normal' ||
                /(?:^|[\s,])(?:filter|backdrop-filter|opacity|mask|mask-image|clip-path|mix-blend-mode)(?:$|[\s,])/.test(style.willChange);
        };
        const px = (value, size = 0) => value.trim().endsWith('%') ? parseFloat(value) * size / 100 : parseFloat(value) || 0;
        const visible = color => (tigerestColor(color)?.[3] ?? 1) !== 0;
        const sides = ['top', 'right', 'bottom', 'left'];
        const bordered = style => sides.some(side => px(style.getPropertyValue(`border-${side}-width`)) > 0 &&
            !['none', 'hidden'].includes(style.getPropertyValue(`border-${side}-style`)) && visible(style.getPropertyValue(`border-${side}-color`)));
        const pseudoPainted = (node, pseudo) => {
            const style = getComputedStyle(node, pseudo);
            return !['none', 'normal'].includes(style.content) && (style.content !== '""' || style.backgroundImage !== 'none' ||
                visible(style.backgroundColor) || style.boxShadow !== 'none' || bordered(style) || style.outlineStyle !== 'none');
        };
        const textRects = node => [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && child.data.trim())
            .flatMap(child => { const range = document.createRange(); range.selectNodeContents(child); return [...range.getClientRects()]; });
        const rects = new Map(), rect = node => rects.get(node) || rects.set(node, node.getBoundingClientRect()).get(node);
        const overlaps = (a, b, grow = 0) => a.left - grow < b.right && b.left < a.right + grow && a.top - grow < b.bottom && b.top < a.bottom + grow;
        const within = (box, inner, inset = [0, 0, 0, 0]) => inner.left >= box.left + inset[3] - .5 && inner.right <= box.right - inset[1] + .5 &&
            inner.top >= box.top + inset[0] - .5 && inner.bottom <= box.bottom - inset[2] + .5;
        // How far a box's outer shadows and outline reach beyond it.
        const reach = style => {
            let extent = style.outlineStyle !== 'none' ? Math.max(0, px(style.outlineWidth) + px(style.outlineOffset)) : 0;
            if (style.boxShadow !== 'none') for (const shadow of style.boxShadow.split(/,(?![^(]*\))/)) {
                if (/\binset\b/.test(shadow)) continue;
                const [x = 0, y = 0, blur = 0, spread = 0] = (shadow.replace(/[a-z]+\([^)]*\)/gi, '').match(/-?[\d.]+px/g) || []).map(parseFloat);
                extent = Math.max(extent, Math.abs(x) + Math.abs(y) + blur + Math.max(0, spread));
            }
            return extent;
        };
        const replaced = 'img, svg, video, canvas, iframe, object, embed, picture, input, select, textarea, progress, meter';
        // A pseudo-element can paint outside its owner's box. Its nearest
        // clipping ancestor is a safe upper bound; without one, any part of
        // the header may be covered. Do not infer pseudo geometry from its
        // owner (positioned and transformed decorations commonly overflow).
        const pseudoBounds = (node, pseudo) => {
            const style = getComputedStyle(node, pseudo), owner = styles.get(node);
            let bound = rect(header);
            for (let parent = node; parent && styles.has(parent); parent = parent.parentElement) {
                const ancestor = styles.get(parent);
                // Out-of-flow descendants can escape overflow clips between
                // them and their containing block. Only use an absolute
                // pseudo's own positioned owner here; more complex containing
                // blocks keep the conservative bound. Paint containment is
                // independently safe for all positioning modes.
                const overflowApplies = !['absolute', 'fixed'].includes(style.position) ||
                    style.position === 'absolute' && parent === node && owner.position !== 'static';
                if (overflowApplies && ['hidden', 'clip', 'auto', 'scroll'].includes(ancestor.overflowX) &&
                    ['hidden', 'clip', 'auto', 'scroll'].includes(ancestor.overflowY) ||
                    /\b(?:paint|strict|content)\b/.test(ancestor.contain)) { bound = rect(parent); break; }
            }
            const length = value => /^-?[\d.]+px$/.test(value);
            // Common underline/decorations: a known absolute box in this
            // positioned owner. More complex transforms or automatic sizes
            // retain the conservative clipping bound above.
            let translatedOnly = true;
            for (let parent = node; parent && styles.has(parent); parent = parent.parentElement) {
                const transform = styles.get(parent).transform;
                if (transform !== 'none' && !/^matrix\(1, 0, 0, 1, [-\d.]+, [-\d.]+\)$/.test(transform)) translatedOnly = false;
            }
            const mayScroll = node.scrollLeft !== 0 || node.scrollTop !== 0 ||
                node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight;
            if (!mayScroll && translatedOnly && owner.position !== 'static' && style.position === 'absolute' && style.transform === 'none' &&
                ['left', 'top', 'width', 'height', 'marginLeft', 'marginTop'].every(key => length(style[key]))) {
                const outer = rect(node), borderBox = style.boxSizing === 'border-box';
                const left = outer.left + px(owner.borderLeftWidth) + px(style.left) + px(style.marginLeft);
                const top = outer.top + px(owner.borderTopWidth) + px(style.top) + px(style.marginTop);
                const width = px(style.width) + (borderBox ? 0 : px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth));
                const height = px(style.height) + (borderBox ? 0 : px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth));
                const area = grown({left, top, right: left + width, bottom: top + height}, reach(style));
                return {left: Math.max(bound.left, area.left), top: Math.max(bound.top, area.top),
                    right: Math.min(bound.right, area.right), bottom: Math.min(bound.bottom, area.bottom)};
            }
            return bound;
        };
        // Where a box paints: its box with shadows and outline, or its text.
        const grown = (box, by) => ({left: box.left - by, top: box.top - by, right: box.right + by, bottom: box.bottom + by});
        // Ordinary in-flow artwork cannot paint past an ancestor's overflow
        // clip. Use its border box as a conservative bound (also for rounded
        // clips); out-of-flow descendants and pseudo-elements need separate
        // containing-block reasoning and keep their existing wider bounds.
        const visiblePainting = (node, area) => {
            let result = {...area}, current = node;
            for (let parent = node.parentElement; parent && styles.has(parent); current = parent, parent = parent.parentElement) {
                if (!['static', 'relative'].includes(styles.get(current).position)) break;
                const style = styles.get(parent);
                if (!['hidden', 'auto', 'scroll'].includes(style.overflowX) ||
                    !['hidden', 'auto', 'scroll'].includes(style.overflowY)) continue;
                const clip = rect(parent);
                result = {left: Math.max(result.left, clip.left), top: Math.max(result.top, clip.top),
                    right: Math.min(result.right, clip.right), bottom: Math.min(result.bottom, clip.bottom)};
            }
            return result;
        };
        const paintings = new Map();
        const painting = node => paintings.get(node) ?? paintings.set(node, (() => {
            const style = styles.get(node);
            if (style.visibility === 'hidden' || !node.getClientRects().length) return [];
            const box = visible(value(node, 'background-color')) || value(node, 'background-image') !== 'none' || style.boxShadow !== 'none' ||
                bordered(style) || style.outlineStyle !== 'none' || node.matches(replaced);
            const areas = box ? [visiblePainting(node, grown(rect(node), reach(style)))] : textRects(node).map(area => visiblePainting(node, area));
            for (const pseudo of ['::before', '::after']) if (pseudoPainted(node, pseudo)) areas.push(pseudoBounds(node, pseudo));
            return areas;
        })()).get(node);
        // The colour model holds only where every ancestor's background fully
        // covers the node, nothing else of theirs (borders, text, inset
        // shadows, painted pseudo-elements) lies under it, and no other box of
        // the root (a sibling's drop shadow, an icon) paints into its area.
        // A backdrop filter samples only its own box, so neighbours outside
        // it do not count.
        const uniformUnder = (node, chain) => {
            const box = rect(node);
            for (const parent of chain) {
                const style = styles.get(parent), outer = rect(parent);
                if (value(parent, 'background-image') !== 'none' || /\binset\b/.test(value(parent, 'box-shadow')) ||
                    pseudoPainted(parent, '::before') || pseudoPainted(parent, '::after') || style.outlineStyle !== 'none' && px(style.outlineOffset) < 0 ||
                    textRects(parent).some(text => overlaps(text, box))) return false;
                const border = sides.map(side => px(style.getPropertyValue(`border-${side}-width`)));
                if (bordered(style) && !within(outer, box, border)) return false;
                if (!visible(value(parent, 'background-color'))) continue;
                if (style.backgroundClip === 'text') return false;
                const padding = sides.map(side => px(style.getPropertyValue(`padding-${side}`)));
                const clip = {'padding-box': border, 'content-box': border.map((width, index) => width + padding[index])}[style.backgroundClip] || [0, 0, 0, 0];
                if (!within(outer, box, clip)) return false;
                // Rounded corners leave their outside uncovered.
                const radius = Math.max(...['top-left', 'top-right', 'bottom-right', 'bottom-left'].flatMap(corner =>
                    style.getPropertyValue(`border-${corner}-radius`).split(/\s+/).map(part => px(part, Math.max(outer.width, outer.height)))));
                if (radius > 0 && [[outer.left, outer.top], [outer.right - radius, outer.top], [outer.left, outer.bottom - radius], [outer.right - radius, outer.bottom - radius]]
                    .some(([left, top]) => overlaps({left, top, right: left + radius, bottom: top + radius}, box))) return false;
            }
            const root = chain[0], skipped = new Set(chain);
            for (const other of root.querySelectorAll('*')) {
                if (other !== node && !skipped.has(other) && !node.contains(other) &&
                    // A sub-pixel seam (a lifted tab) is not paint under the box.
                    painting(other).some(area => overlaps(area, box, -1))) return false;
            }
            return true;
        };
        const flat = [];
        for (const node of nodes) {
            const style = styles.get(node), filter = value(node, 'backdrop-filter');
            const clip = style.backgroundClip.split(',').at(-1).trim();
            const coversBackdrop = clip === 'border-box' || ['padding-box', 'content-box'].includes(clip) &&
                sides.every(side => px(style.getPropertyValue(`border-${side}-width`)) === 0 &&
                    (clip === 'padding-box' || px(style.getPropertyValue(`padding-${side}`)) === 0));
            if (filter === 'none' || !settled(node) || value(node, 'filter') !== 'none' || style.mixBlendMode !== 'normal' ||
                !coversBackdrop ||
                !tigerestSkinnedControl(node, style)) continue;
            // What the Backdrop Root holds under the node: the root's own
            // background, then those of the plain ancestors in between.
            const chain = [];
            for (let parent = node.parentElement; parent; parent = parent.parentElement) {
                chain.unshift(parent);
                if (isolates(parent)) break;
            }
            let under = uniformUnder(node, chain) ? [0, 0, 0, 0] : null;
            for (const parent of chain) {
                const color = under && tigerestColor(value(parent, 'background-color'));
                if (!color) { under = null; break; }
                under = tigerestOver(color, under);
            }
            const backdrop = under && tigerestFilteredColor(filter, under);
            const own = tigerestColor(value(node, 'background-color'));
            if (!backdrop || !own) continue;
            // Old order: filtered backdrop, own colour, own images. One colour
            // under the same images paints the same pixels.
            flat.push([node, tigerestOver(own, backdrop)]);
        }
        // A retained child filter still samples its original Backdrop Root.
        // Removing that root (even if its own pixels match) changes what the
        // child sees. Keep filtered ancestors whenever a descendant must keep
        // its real filter; process bottom-up so this propagates outward.
        const replacements = new Set(flat.map(([node]) => node));
        for (const node of [...nodes].reverse()) {
            if (value(node, 'backdrop-filter') === 'none' || replacements.has(node)) continue;
            for (let parent = node.parentElement; parent && parent !== header; parent = parent.parentElement)
                replacements.delete(parent);
        }
        for (const [node, color] of flat) {
            if (!replacements.has(node)) continue;
            const value = `rgba(${color.slice(0, 3).map(v => +v.toFixed(2)).join(', ')}, ${+color[3].toFixed(4)})`;
            if (node.style.getPropertyValue('--tigerest-flat-glass-bg') !== value) node.style.setProperty('--tigerest-flat-glass-bg', value);
            node.setAttribute(TIGEREST_FLAT_GLASS, '');
        }
    }
}

let tigerestHeaderGlassFrame = 0;
function scheduleTigerestHeaderGlass() {
    if (!TIGEREST_BACKDROP_ROOTS || tigerestHeaderGlassFrame) return;
    tigerestHeaderGlassFrame = requestAnimationFrame(() => {
        tigerestHeaderGlassFrame = 0;
        flattenTigerestHeaderGlass();
    });
}

function observeTigerestHeaderGlass() {
    if (!TIGEREST_BACKDROP_ROOTS || !document.documentElement) return;
    // Headers, their controls and the page's stylesheets change rarely; a
    // scrolled media wall does not touch them.
    const relevant = node => node?.nodeType === Node.ELEMENT_NODE &&
        (node.matches('.skinHeader, style, link') || !!node.closest('.skinHeader') || !!node.querySelector?.('.skinHeader'));
    new MutationObserver(records => {
        if (records.some(record => record.target === document.head || record.target === document.body && record.type === 'attributes' ||
            relevant(record.type === 'characterData' ? record.target.parentElement : record.target) ||
            [...record.addedNodes, ...record.removedNodes].some(relevant))) scheduleTigerestHeaderGlass();
    }).observe(document.documentElement, {subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['class', 'style', 'href', 'media', 'rel', 'disabled']});
    // A linked stylesheet applies once it loads, not when it is inserted.
    const loaded = event => { if (event.target?.localName === 'link') scheduleTigerestHeaderGlass(); };
    document.addEventListener('load', loaded, true);
    document.addEventListener('error', loaded, true);
    // Hover, press and focus restyle controls without a mutation.
    const interaction = event => { if (event.target?.closest?.('.skinHeader')) scheduleTigerestHeaderGlass(); };
    for (const type of ['pointerover', 'pointerout', 'pointerdown', 'pointerup', 'pointercancel', 'focusin', 'focusout'])
        document.addEventListener(type, interaction, {capture: true, passive: true});
    window.addEventListener('resize', scheduleTigerestHeaderGlass);
    scheduleTigerestHeaderGlass();
}

function initializeTigerestAppearance() {
    mountTigerestAppearanceStyles();
    observeTigerestPages();
    observeTigerestHeaderGlass();
    scheduleTigerestAmbient(document);

    document.addEventListener('click', handleTigerestTabClick, true);

    document.addEventListener('viewshow', event => {
        const page = event.target?.matches?.(TIGEREST_PAGE_SELECTOR) ? event.target : null;
        if (!page) return;
        scheduleTigerestPageAnimation(page);
        scheduleTigerestAmbient(page);
    }, true);
}

if (document.head && document.documentElement) {
    initializeTigerestAppearance();
} else {
    document.addEventListener('DOMContentLoaded', initializeTigerestAppearance, {once: true});
}
