(function () {
    'use strict';
    const styleId = 'tigerest-home-gallery-style';
    const identity = api => api ? [api.serverAddress(), api.serverId(), api.getCurrentUserId()].join('|') : '';
    function reveal(list, item) {
        const frame = list.getBoundingClientRect(), box = item.getBoundingClientRect();
        if (box.top < frame.top) list.scrollTop += box.top - frame.top;
        else if (box.bottom > frame.bottom) list.scrollTop += box.bottom - frame.bottom;
        if (box.left < frame.left) list.scrollLeft += box.left - frame.left;
        else if (box.right > frame.right) list.scrollLeft += box.right - frame.right;
    }
    const css = `
    body.tg-home-active .skinHeader, body.tg-home-active .mainDrawer, body.tg-home-active .appFooter { display: none !important; }
    body.tg-home-active .view-home-home { left: 0 !important; right: 0 !important; width: 100% !important; margin: 0 !important; padding: 0 !important; }
    .tg-home-host { overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }
    .tg-home { --home-height: 650px; box-sizing: border-box; height: var(--home-height); min-height: 380px; padding: 18px 28px 22px;
        display: grid; grid-template-columns: clamp(160px,19vw,280px) minmax(0,1fr); grid-template-rows: minmax(0,1fr) 158px;
        gap: 20px 24px; position: relative; isolation: isolate; color: #f4f2ed; text-align: left; }
    .tg-home *, .tg-home *::before, .tg-home *::after { box-sizing: border-box; }
    .tg-home button { font: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .tg-home button:focus-visible { outline: 2px solid #efc36e; outline-offset: -4px; }
    .tg-home-nav { grid-column: 1; grid-row: 1 / 3; display: flex; flex-direction: column; gap: 12px; min-height: 0; min-width: 0; }
    .tg-home-eyebrow { font-size: 10px; letter-spacing: .2em; color: #afa89e; margin: 0 0 2px; padding-left: 4px; text-transform: uppercase; }
    .tg-library-list { display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; padding: 3px; }
    .tg-library { position: relative; flex: 0 0 auto; width: 100%; height: clamp(92px,calc((var(--home-height) - 98px)/4),178px); border: 1px solid #ffffff16;
        border-radius: 16px; overflow: hidden; background: #1d2129; text-align: left; padding: 16px 18px; transition: border-color .25s, box-shadow .25s, transform .25s; }
    .tg-library img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .7; transition: transform .65s, opacity .3s; pointer-events: none; }
    .tg-library::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg,#070b11b8,#0b0e1430),linear-gradient(0deg,#0a0c1280,transparent 65%); pointer-events: none; }
    .tg-library:hover img, .tg-library.is-selected img { transform: scale(1.05); opacity: .95; }
    .tg-library:hover, .tg-library.is-selected { border-color: #e8b85eac; box-shadow: inset 0 0 0 1px #e8b85e25,0 6px 24px #0003; }
    .tg-library-label { position: relative; z-index: 1; display: flex; height: 100%; flex-direction: column; justify-content: center; }
    .tg-library-name { font-size: clamp(18px,2vw,30px); font-weight: 650; line-height: 1.3; overflow-wrap: anywhere; text-shadow: 0 2px 12px #0008; }
    .tg-library-index { font-size: 10px; letter-spacing: .13em; margin-top: 7px; color: #ded8c9af; }
    .tg-library.is-selected .tg-library-index { color: #f0c879; }
    .tg-home-stage { grid-column: 2; grid-row: 1; position: relative; min-width: 0; min-height: 0; overflow: hidden; border-radius: 22px; background: #171a21; }
    .tg-home-hero { position: absolute; inset: 0; border: 0; border-radius: inherit; width: 100%; height: 100%; overflow: hidden;
        background: radial-gradient(ellipse at 75% 30%,#3e394b,#151920 70%); text-align: left; padding: 0; opacity: 0; transform: scale(1.025);
        transition: opacity .65s ease, transform .95s cubic-bezier(.2,.7,.2,1); }
    .tg-entered.tg-ready .tg-home-hero { opacity: 1; transform: scale(1); }
    .tg-home-hero:disabled { cursor: default; }
    .tg-poster-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transform: scale(1.035); transition: opacity .6s,transform 6.5s linear; }
    .tg-poster-image.is-visible { opacity: 1; transform: scale(1); }
    .tg-hero-shade { position: absolute; inset: 0; background: linear-gradient(0deg,#080a10f5, #080a1080 25%,transparent 67%),linear-gradient(90deg,#080a1030,transparent 75%); }
    .tg-hero-content { position: absolute; left: clamp(20px,3vw,48px); right: 36px; bottom: 34px; display: flex; flex-direction: column; gap: 10px; }
    .tg-hero-kicker { font-size: 11px; letter-spacing: .13em; color: #f5d99a; }
    .tg-hero-title { font-size: clamp(24px,3.1vw,48px); font-weight: 650; line-height: 1.18; max-width: 1000px; text-shadow: 0 3px 20px #0009; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .tg-hero-subtitle { color: #d8d6d0; font-size: 13px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
    .tg-hero-action { font-size: 12px; margin-top: 5px; color: #fff; }
    .tg-hero-action::after { content: ' ↗'; color: #f0c879; margin-left: 4px; }
    .tg-home-status { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 16px; padding: 24px; color: #c7c4bc; text-align: center; }
    .tg-home-status[hidden] { display: none; }
    .tg-home-retry { background: #343437; border: 1px solid #ffffff30; border-radius: 30px; padding: 9px 24px; }
    .tg-home-rail { grid-column: 2; grid-row: 2; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
    .tg-rail-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; height: 19px; padding: 0 3px; }
    .tg-rail-title { font-size: 13px; font-weight: 600; letter-spacing: .04em; }
    .tg-rail-counter { color: #b8afa0; font-size: 11px; font-variant-numeric: tabular-nums; }
    .tg-cover-list { display: flex; gap: 12px; overflow-x: auto; overflow-y: hidden; min-height: 0; padding: 3px 3px 8px; scrollbar-width: thin; scroll-snap-type: x proximity; }
    .tg-cover { position: relative; flex: 0 0 clamp(145px,15vw,236px); height: 112px; border: 1px solid #ffffff16; border-radius: 12px; padding: 0; overflow: hidden;
        background: #252730; text-align: left; scroll-snap-align: start; transition: border-color .2s,opacity .2s; }
    .tg-cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform .4s; }
    .tg-cover:hover img { transform: scale(1.05); }
    .tg-cover::after { content: ''; position: absolute; inset: 0; background: linear-gradient(0deg,#0b0c12ec,transparent 80%); pointer-events: none; }
    .tg-cover.is-selected { border-color: #e9bd63; box-shadow: inset 0 0 0 1px #e9bd6380; }
    .tg-cover.is-selected::before { content: ''; z-index: 2; position: absolute; left: 12px; right: 12px; bottom: 0; height: 3px; background: #edc471; border-radius: 3px; }
    .tg-cover-label { z-index: 1; position: absolute; left: 12px; right: 12px; bottom: 12px; font-size: 12px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    @media (max-width: 680px) {
        .tg-home { padding: 10px 14px 20px; min-height: 490px; grid-template-columns: minmax(0,1fr); grid-template-rows: 105px minmax(220px,1fr) 144px; gap: 14px; }
        .tg-home-nav { grid-column: 1; grid-row: 1; gap: 5px; }
        .tg-home-eyebrow { font-size: 9px; }
        .tg-library-list { flex-direction: row; overflow-y: hidden; overflow-x: auto; gap: 9px; padding: 2px 2px 5px; }
        .tg-library { width: 144px; height: 78px; border-radius: 12px; padding: 10px 12px; }
        .tg-library-name { font-size: 18px; }
        .tg-library-index { font-size: 8px; margin-top: 4px; }
        .tg-home-stage { grid-column: 1; grid-row: 2; border-radius: 16px; }
        .tg-home-rail { grid-column: 1; grid-row: 3; }
        .tg-hero-content { left: 20px; right: 20px; bottom: 24px; }
        .tg-hero-title { font-size: 27px; }
        .tg-hero-subtitle { font-size: 11px; }
        .tg-cover { height: 100px; flex-basis: 160px; }
    }
    @media (min-width: 681px) and (max-height: 520px) {
        .tg-home { min-height: 320px; padding: 8px 20px 14px; grid-template-rows: minmax(140px,1fr) 116px; gap: 12px 16px; }
        .tg-library { height: 84px; padding: 10px 14px; }
        .tg-library-name { font-size: 18px; }
        .tg-cover { height: 78px; }
        .tg-hero-content { bottom: 18px; gap: 6px; }
        .tg-hero-title { font-size: 24px; }
        .tg-hero-action { display: none; }
    }
    @media (prefers-reduced-motion: reduce) { .tg-home *, .tg-home *::before { animation: none !important; transition: none !important; transform: none !important; } }
    /* A continuous cinema composition, with navigation floating over its atmosphere. */
    .tg-home { padding: 10px 24px 24px; gap: 22px 34px; grid-template-columns: clamp(160px,18vw,380px) minmax(0,1fr); grid-template-rows: minmax(0,1fr) 196px;
        background: linear-gradient(90deg,#0b0d12eb, #0b0d1200 45%); }
    .tg-home-scenery { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .16; z-index: -2; pointer-events: none;
        mask-image: linear-gradient(0deg,transparent,#000 35%,#000 80%,transparent); transition: opacity .8s; }
    .tg-home::before { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; background: radial-gradient(ellipse at 80% 5%,#87705512,transparent 55%); }
    .tg-home-nav { gap: 16px; }
    .tg-library-list { gap: 14px; scrollbar-width: none; }
    .tg-library-list::-webkit-scrollbar { display: none; }
    .tg-library { border-radius: 6px 22px 6px 6px; border-color: #ffffff08; padding: 18px 22px; background: #11141b; height: clamp(92px,calc((var(--home-height) - 106px)/4),320px); }
    .tg-library img { opacity: .5; filter: saturate(.6); transform: scale(1.04); }
    .tg-library:hover img, .tg-library.is-selected img { opacity: 1; filter: saturate(1.1); transform: scale(1.13); }
    .tg-library-label { transition: transform .35s cubic-bezier(.2,.8,.2,1); }
    .tg-library.is-selected .tg-library-label { transform: translateX(5px); }
    .tg-library-name { font-size: clamp(22px,2.2vw,34px); font-weight: 750; letter-spacing: .025em; }
    .tg-library::before { content: ''; position: absolute; left: 0; top: 20%; bottom: 20%; width: 3px; z-index: 3; background: #f0c879; transform: scaleY(0); transition: transform .35s; }
    .tg-library.is-selected::before { transform: scaleY(1); }
    .tg-library.is-selected { border-color: #cda76875; box-shadow: 0 12px 35px #0006; }
    .tg-home-stage { border-radius: 8px 8px 0 0; background: transparent; }
    .tg-home-hero { background: radial-gradient(ellipse at 75% 30%,#34334170,#12141a00 75%); transform: scale(1.07); transition: opacity .8s ease,transform 1.6s cubic-bezier(.12,.7,.2,1); }
    .tg-poster-image { mask-image: linear-gradient(0deg,transparent,#000 20%,#000 96%); transform: scale(1.08); transition: opacity .65s,transform 8s linear; }
    .tg-hero-shade { background: linear-gradient(0deg,#0b0d12,#0b0d12b0 20%,transparent 60%),linear-gradient(90deg,#0b0d1240,transparent 65%); }
    .tg-hero-content { left: clamp(22px,3.2vw,50px); right: 42px; bottom: 34px; gap: 12px; }
    .tg-hero-title { font-size: clamp(30px,4.1vw,68px); font-weight: 750; letter-spacing: -.025em; line-height: 1.18; }
    .tg-hero-kicker { font-size: 11px; letter-spacing: .16em; }
    .tg-hero-subtitle { font-size: 13px; color: #bcbab3; }
    .tg-hero-action { display: inline-flex; align-self: flex-start; align-items: center; margin-top: 10px; padding: 10px 18px; border: 1px solid #ffffff38; border-radius: 4px; background: #ffffff08; font-size: 12px; }
    .tg-hero-ordinal { position: absolute; top: 25px; right: 28px; color: #f5eee0b0; font-size: 11px; letter-spacing: .15em; border-top: 1px solid #f5eee070; padding-top: 8px; }
    .tg-home-rail { gap: 13px; padding-top: 8px; border-top: 1px solid #ffffff18; }
    .tg-rail-title { font-size: 12px; color: #d9d2c6; }
    .tg-cover-list { gap: 15px; scrollbar-width: none; }
    .tg-cover-list::-webkit-scrollbar { display: none; }
    .tg-cover { height: 116px; border-radius: 5px; border-color: #ffffff13; flex-basis: clamp(170px,17vw,270px); }
    .tg-cover.is-selected { border-color: #d9b273; box-shadow: 0 0 22px #c7a56d18; }
    .tg-cover-label { font-size: 12px; }
    @media (max-width:680px) {
        .tg-home { padding: 10px 12px 18px; grid-template-columns: minmax(0,1fr); grid-template-rows: 105px minmax(220px,1fr) 154px; gap: 13px; }
        .tg-home-nav { gap: 5px; }.tg-library-list { gap: 10px; }.tg-library { height: 78px; width: 146px; padding: 10px 12px; border-radius: 4px 14px 4px 4px; }
        .tg-library-name { font-size: 19px; }.tg-library.is-selected .tg-library-label { transform: none; }
        .tg-hero-content { left: 18px; right: 18px; bottom: 20px; gap: 9px; }.tg-hero-title { font-size: 32px; }.tg-hero-subtitle { font-size: 11px; }
        .tg-hero-action { padding: 8px 12px; font-size: 11px; margin-top: 6px; }.tg-hero-ordinal { top: 18px; right: 18px; font-size: 9px; }
        .tg-home-rail { padding-top: 8px; gap: 8px; }.tg-cover { height: 96px; flex-basis: 170px; }
    }
    @media (min-width:681px) and (max-height:520px) {
        .tg-home { padding: 8px 20px 14px; grid-template-rows: minmax(140px,1fr) 128px; gap: 12px 20px; }
        .tg-library { height: 84px; padding: 10px 14px; }.tg-library-name { font-size: 19px; }.tg-cover { height: 74px; }
        .tg-home-rail { padding-top: 6px; gap: 8px; }.tg-hero-content { bottom: 18px; gap: 6px; }.tg-hero-title { font-size: 27px; }.tg-hero-action { display:none; }
    }
    .tg-home-styles { display: flex; gap: 2px; margin-left: auto; padding: 3px; border: 1px solid #ffffff17; border-radius: 3px; background: #0b0d1260; }
    .tg-home-style-button { border: 0; padding: 4px 10px; background: transparent; font-size: 12px !important; color: #bcb7ae !important; white-space: nowrap; border-radius: 2px; }
    .tg-home-style-button[aria-pressed="true"] { background: #d1b48324; color: #e7c688 !important; }
    .tg-rail-heading { height: 28px; }
    .tg-rail-title { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tg-rail-counter { flex: 0 0 auto; }
    .tg-home[data-style="cinema"] .tg-cover { height: 130px; flex-basis: 88px; }
    .tg-home[data-style="cinema"] .tg-cover-label { font-size: 10px; left: 8px; right: 8px; bottom: 10px; }
    .tg-home[data-style="pulse"] { background: #0a0c14; gap: 20px 28px; grid-template-columns: clamp(160px,17vw,340px) minmax(0,1fr); }
    .tg-home[data-style="pulse"]::before { background: linear-gradient(115deg,#39276324,transparent 45%),linear-gradient(0deg,#082b363b,transparent 60%); }
    .tg-home[data-style="pulse"] .tg-home-scenery { opacity: .12; mix-blend-mode: screen; }
    .tg-home[data-style="pulse"] .tg-home-eyebrow { color: #9aa9be; }
    .tg-home[data-style="pulse"] .tg-library { border-radius: 0; clip-path: polygon(0 0,calc(100% - 18px) 0,100% 18px,100% 100%,18px 100%,0 calc(100% - 18px)); background: #151724; border-color: #788fa53b; }
    .tg-home[data-style="pulse"] .tg-library::after { background: linear-gradient(90deg,#121524d9,#12152420); }
    .tg-home[data-style="pulse"] .tg-library.is-selected { border-color: #5adfeb; box-shadow: inset 0 0 0 1px #5adfeb50; }
    .tg-home[data-style="pulse"] .tg-library::before { background: #67edff; top: 0; bottom: 0; width: 4px; }
    .tg-home[data-style="pulse"] .tg-library-index { color: #afc3d6; }
    .tg-home[data-style="pulse"] .tg-library.is-selected .tg-library-index { color: #75edee; }
    .tg-home[data-style="pulse"] .tg-home-stage { border-radius: 0; clip-path: polygon(26px 0,100% 0,100% calc(100% - 26px),calc(100% - 26px) 100%,0 100%,0 26px); }
    .tg-home[data-style="pulse"] .tg-poster-image { mask-image: linear-gradient(0deg,transparent,#000 24%,#000 100%); }
    .tg-home[data-style="pulse"] .tg-hero-shade { background: linear-gradient(0deg,#0a0c14,#0a0c14b8 20%,transparent 65%); }
    .tg-home[data-style="pulse"] .tg-hero-title { font-weight: 800; font-size: clamp(34px,4.5vw,74px); letter-spacing: -.04em; }
    .tg-home[data-style="pulse"] .tg-hero-kicker { color: #75edee; }
    .tg-home[data-style="pulse"] .tg-hero-action { background: #65e8ef; border: 0; color: #09141c; font-weight: 650; padding: 12px 22px; clip-path: polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,9px 100%,0 calc(100% - 9px)); }
    .tg-home[data-style="pulse"] .tg-hero-action::after { color: #09141c; }
    .tg-home[data-style="pulse"] .tg-hero-ordinal { color: #75edee; border-color: #75edee; }
    .tg-home[data-style="pulse"] .tg-home-rail { border-color: #5bdde943; }
    .tg-home[data-style="pulse"] .tg-cover { border-radius: 0; clip-path: polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%); }
    .tg-home[data-style="pulse"] .tg-cover.is-selected { border-color: #66ebf3; box-shadow: inset 0 0 0 1px #66ebf36b; }
    .tg-home[data-style="pulse"] .tg-cover.is-selected::before { background: #66ebf3; left: 0; right: 0; }
    .tg-home[data-style="pulse"] .tg-home-style-button[aria-pressed="true"] { background: #5adfeb22; color: #75edee !important; }
    .tg-home[data-style="gallery"] { background: #e9e5dc; color: #242b32; padding: 24px 30px; gap: 24px 34px; grid-template-columns: clamp(150px,16vw,360px) minmax(0,1fr); }
    .tg-home[data-style="gallery"]::before { background: linear-gradient(135deg,#f9f5ed90,transparent 70%); }
    .tg-home[data-style="gallery"] .tg-home-scenery { opacity: .06; }
    .tg-home[data-style="gallery"] .tg-home-eyebrow { color: #707063; letter-spacing: .12em; }
    .tg-home[data-style="gallery"] .tg-library { border-radius: 0; box-shadow: none; height: clamp(92px,calc((var(--home-height) - 138px)/4),300px); border: 0; color: #f3eee3; }
    .tg-home[data-style="gallery"] .tg-library.is-selected { box-shadow: inset 0 0 0 2px #b3925e; }
    .tg-home[data-style="gallery"] .tg-library-name { font-size: clamp(20px,2vw,30px); font-family: Georgia,'Noto Serif SC','Songti SC',serif; letter-spacing: .07em; font-weight: 550; }
    .tg-home[data-style="gallery"] .tg-library img { filter: saturate(.75); }
    .tg-home[data-style="gallery"] .tg-home-stage { background: #ddd8cd; border-radius: 0; }
    .tg-home[data-style="gallery"] .tg-home-hero { color: #242b32; transform: scale(1.025); background: #ddd8cd; }
    .tg-home[data-style="gallery"].tg-entered.tg-ready .tg-home-hero { transform: scale(1); }
    .tg-home[data-style="gallery"] .tg-poster-image { width: 66%; mask-image: none; object-position: center; object-fit: contain; padding: 20px 30px; background: #1c2025; }
    .tg-home[data-style="gallery"] .tg-hero-shade { background: linear-gradient(90deg,transparent 65%,#e2ddd2 66%); }
    .tg-home[data-style="gallery"] .tg-hero-content { left: 66%; right: 0; top: 76px; bottom: 28px; padding: 22px 28px; gap: 17px; justify-content: center; }
    .tg-home[data-style="gallery"] .tg-hero-title { font: 500 clamp(23px,2.5vw,40px)/1.35 Georgia,'Noto Serif SC','Songti SC',serif; letter-spacing: .04em; text-shadow: none; -webkit-line-clamp: 4; }
    .tg-home[data-style="gallery"] .tg-hero-kicker { color: #8a734d; font-size: 10px; line-height: 1.7; }
    .tg-home[data-style="gallery"] .tg-hero-subtitle { color: #746f64; font-size: 11px; white-space: normal; line-height: 1.8; }
    .tg-home[data-style="gallery"] .tg-hero-action { border: 0; border-bottom: 1px solid #92836b; padding: 8px 0; background: transparent; border-radius: 0; color: #373d3d; }
    .tg-home[data-style="gallery"] .tg-hero-action::after { color: #8a734d; }
    .tg-home[data-style="gallery"] .tg-hero-ordinal { color: #7e725e; border-color: #b6a98f; }
    .tg-home[data-style="gallery"] .tg-home-rail { border-color: #b6aa923d; }
    .tg-home[data-style="gallery"] .tg-rail-title { color: #555b53; }.tg-home[data-style="gallery"] .tg-rail-counter { color: #817661; }
    .tg-home[data-style="gallery"] .tg-cover { border-radius: 0; color: #fff; border: 0; }
    .tg-home[data-style="gallery"] .tg-cover.is-selected { box-shadow: inset 0 0 0 2px #ae8d52; }
    .tg-home[data-style="gallery"] .tg-home-styles { background: #ded6c740; border-color: #b9ac9140; }
    .tg-home[data-style="gallery"] .tg-home-style-button { color: #777163 !important; }
    .tg-home[data-style="gallery"] .tg-home-style-button[aria-pressed="true"] { background: #ad916d25; color: #6b5735 !important; }
    @media (max-width:900px) { .tg-home[data-style="gallery"] .tg-hero-content { padding: 12px 18px; top: 48px; gap: 12px; } }
    @media (max-width:680px) {
        .tg-home[data-style="pulse"], .tg-home[data-style="gallery"] { padding: 10px 12px 18px; grid-template-columns: minmax(0,1fr); grid-template-rows: 105px minmax(220px,1fr) 154px; gap: 13px; }
        .tg-home[data-style="gallery"] .tg-library { height: 78px; }.tg-home[data-style="gallery"] .tg-library-name { font-size: 18px; }
        .tg-home[data-style="pulse"] .tg-hero-title { font-size: 34px; }
        .tg-home[data-style="gallery"] .tg-poster-image { width: 100%; padding: 0; object-fit: cover; object-position: center 20%; }
        .tg-home[data-style="gallery"] .tg-hero-content { top: auto; left: 0; right: 0; bottom: 0; padding: 24px 20px; gap: 8px; }
        .tg-home[data-style="gallery"] .tg-hero-shade { background: linear-gradient(0deg,#e5dfd4,#e5dfd4d4 28%,transparent 65%); }
        .tg-home[data-style="gallery"] .tg-hero-title { font-size: 28px; -webkit-line-clamp: 2; }
        .tg-home[data-style="gallery"] .tg-hero-action { display: none; }
        .tg-home-styles { gap: 0; padding: 2px; }.tg-home-style-button { padding: 4px 5px; font-size: 10px !important; }.tg-rail-counter { display: none; }
        .tg-home[data-style="cinema"] .tg-cover { height: 98px; flex-basis: 70px; }
    }
    @media (min-width:681px) and (max-height:520px) {
        .tg-home[data-style="pulse"], .tg-home[data-style="gallery"] { padding: 8px 20px 14px; grid-template-rows: minmax(140px,1fr) 128px; gap: 12px 20px; }
        .tg-home[data-style="gallery"] .tg-library { height: 84px; }.tg-home[data-style="gallery"] .tg-hero-content { top: 30px; padding: 10px 18px; bottom: 10px; gap: 8px; }
        .tg-home[data-style="gallery"] .tg-hero-title { font-size: 23px; -webkit-line-clamp: 2; }.tg-home[data-style="pulse"] .tg-hero-title { font-size: 30px; }
        .tg-home[data-style="gallery"] .tg-hero-action { display: none; }
        .tg-home[data-style="cinema"] .tg-cover { height: 76px; flex-basis: 54px; }
    }
    `;
    function element(tag, className, text) {
        const node = document.createElement(tag); node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }
    function Gallery(host, options) {
        this.host = host; this.options = options; this.generation = 0; this.selection = 0;
        this.cache = new Map(); this.animations = []; this.listeners = []; this.timer = null;
        if (!document.getElementById(styleId)) { const style = element('style', ''); style.id = styleId; style.textContent = css; document.head.append(style); }
        host.classList.add('tg-home-host');
        host.replaceChildren();
        this.root = element('section', 'tg-home'); this.root.setAttribute('aria-label', '媒体首页');
        this.scenery = element('img', 'tg-home-scenery'); this.scenery.alt = '';
        this.nav = element('nav', 'tg-home-nav'); this.nav.setAttribute('aria-label', '媒体库');
        this.libraryList = element('div', 'tg-library-list');
        this.nav.append(element('p', 'tg-home-eyebrow', 'YOUR LIBRARY / 我的媒体'), this.libraryList);
        this.stage = element('div', 'tg-home-stage'); this.hero = element('button', 'tg-home-hero'); this.hero.type = 'button';
        this.heroImages = element('div', 'tg-hero-images');
        const content = element('div', 'tg-hero-content');
        this.kicker = element('span', 'tg-hero-kicker'); this.title = element('span', 'tg-hero-title'); this.subtitle = element('span', 'tg-hero-subtitle');
        content.append(this.kicker, this.title, this.subtitle, element('span', 'tg-hero-action', '查看作品'));
        this.ordinal = element('span', 'tg-hero-ordinal');
        this.hero.append(this.heroImages, element('span', 'tg-hero-shade'), content, this.ordinal);
        this.status = element('div', 'tg-home-status'); this.message = element('span', '', '正在载入媒体库…');
        this.retry = element('button', 'tg-home-retry', '重试'); this.retry.type = 'button'; this.retry.hidden = true;
        this.status.append(this.message, this.retry); this.stage.append(this.hero, this.status);
        this.rail = element('section', 'tg-home-rail'); const heading = element('div', 'tg-rail-heading');
        this.railTitle = element('span', 'tg-rail-title', '最近入库'); this.counter = element('span', 'tg-rail-counter');
        this.styleSwitch = element('div', 'tg-home-styles'); this.styleSwitch.setAttribute('role', 'group'); this.styleSwitch.setAttribute('aria-label', '首页风格');
        [['cinema','沉浸影院'],['pulse','锋芒舞台'],['gallery','光影画廊']].forEach(([id,name]) => { const button = element('button', 'tg-home-style-button', name); button.type = 'button'; button.dataset.style = id; this.styleSwitch.append(button); });
        heading.append(this.railTitle, this.styleSwitch, this.counter); this.coverList = element('div', 'tg-cover-list'); this.coverList.setAttribute('aria-label', '最近入库作品');
        this.rail.append(heading, this.coverList); this.root.append(this.scenery, this.nav, this.stage, this.rail); host.append(this.root);
        const listen = (node, event, fn) => { node.addEventListener(event, fn); this.listeners.push(() => node.removeEventListener(event, fn)); };
        listen(this.styleSwitch, 'click', event => { const button = event.target.closest('.tg-home-style-button'); if (button) this.setStyle(button.dataset.style); });
        listen(this.libraryList, 'pointerover', event => {
            if (event.pointerType === 'touch') return;
            const button = event.target.closest('.tg-library');
            if (button && !button.contains(event.relatedTarget)) this.preview(button.dataset.libraryId);
        });
        listen(this.libraryList, 'focusin', event => { const button = event.target.closest('.tg-library'); if (button) { this.finishEntrance(); reveal(this.libraryList, button); this.preview(button.dataset.libraryId); } });
        listen(this.libraryList, 'click', event => {
            const button = event.target.closest('.tg-library'); if (!button || !this.valid()) return;
            const library = this.libraries.find(item => item.Id === button.dataset.libraryId);
            if (library.kind === 'favorites') (this.options.openFavorites || (() => this.options.router.showFavorites()))();
            else this.options.router.showItem(library, this.api.serverId());
        });
        listen(this.hero, 'click', () => this.open(this.cards?.[this.index]));
        listen(this.coverList, 'click', event => { const button = event.target.closest('.tg-cover'); if (button) this.open(this.cards.find(card => card.item.Id === button.dataset.itemId)); });
        listen(this.coverList, 'pointerover', event => {
            if (event.pointerType === 'touch') return;
            const button = event.target.closest('.tg-cover'); if (button && !button.contains(event.relatedTarget)) this.select(Number(button.dataset.index), false);
        });
        listen(this.coverList, 'focusin', event => { const button = event.target.closest('.tg-cover'); if (button) { this.finishEntrance(); reveal(this.coverList, button); this.select(Number(button.dataset.index), false); } });
        listen(this.retry, 'click', () => this.selectedLibrary ? this.preview(this.selectedLibrary.Id, true) : this.start({}));
        this.resize = () => this.root.style.setProperty('--home-height', Math.max(320, window.innerHeight - this.host.getBoundingClientRect().top - 8) + 'px');
        listen(window, 'resize', this.resize);
        this.resizeObserver = new ResizeObserver(this.resize); this.resizeObserver.observe(host);
        let style = 'cinema'; try { style = localStorage.getItem('tigerest-home-style') || style; } catch (error) {}
        this.setStyle(style, false);
    }
    Gallery.prototype.setStyle = function (style, animate = true) {
        if (!['cinema','pulse','gallery'].includes(style)) style = 'cinema';
        this.root.dataset.style = style;
        this.styleSwitch.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.style === style)));
        try { localStorage.setItem('tigerest-home-style', style); } catch (error) {}
        this.resize();
        if (this.cards?.length && this.valid()) {
            this.coverList.querySelectorAll('.tg-cover').forEach((button, index) => {
                const image = button.querySelector('img');
                if (image) image.src = this.data.artwork(this.cards[index].item, style === 'cinema' ? 'poster' : 'cover');
            });
            this.select(this.index, false);
        }
        if (animate && this.valid()) { this.root.classList.remove('tg-entered'); this.enter(this.generation); }
    };
    Gallery.prototype.valid = function (generation = this.generation) {
        return this.active && generation === this.generation && identity(this.options.apiProvider()) === this.session;
    };
    Gallery.prototype.start = async function (options = {}) {
        this.stop(); this.active = true; const generation = ++this.generation;
        document.body.classList.add('tg-home-active');
        this.api = this.options.apiProvider(); this.session = identity(this.api); this.cache.clear();
        this.abort = new AbortController(); this.root.classList.remove('tg-entered', 'tg-ready');
        this.libraryList.replaceChildren(); this.clear(); this.resize();
        this.showStatus('正在载入媒体库…');
        if (!this.api || !this.api.getCurrentUserId()) { this.showStatus('请先登录服务器。'); return; }
        this.data = new window.TigerestHomeData(this.api);
        if (options.signal) {
            if (options.signal.aborted) { this.stop(); return; }
            options.signal.addEventListener('abort', () => { if (generation === this.generation) this.stop(); }, { once: true, signal: this.abort.signal });
        }
        try {
            if (this.options.enterFullscreen) {
                try { await this.options.enterFullscreen(this.api, this.abort.signal); } catch (error) { /* Home remains usable if the window manager rejects fullscreen. */ }
                if (!this.valid(generation)) return;
                this.resize();
            }
            this.libraries = await this.data.libraries(this.abort.signal);
            if (!this.valid(generation)) return;
            const artBase = this.options.artBase || window.jmpInfo?.homeArtPath || ((window.jmpInfo?.scriptPath || '') + '/home-art');
            this.libraries.forEach((library, index) => {
                const button = element('button', 'tg-library'); button.type = 'button'; button.dataset.libraryId = library.Id;
                const name = library.Name || '媒体库 ' + (index + 1);
                const art = library.kind === 'favorites' ? 'favorites' : /动漫|动画|[阿啊]你妹|anime|アニメ/i.test(name) ? 'anime' : library.CollectionType === 'movies' ? 'movies' : 'series';
                const image = element('img', ''); image.src = artBase + '/' + art + '.png'; image.alt = ''; image.draggable = false;
                const label = element('span', 'tg-library-label');
                label.append(element('span', 'tg-library-name', name), element('span', 'tg-library-index', library.kind === 'favorites' ? 'FAVORITES' : 'LIBRARY ' + String(index + 1).padStart(2, '0')));
                button.append(image, label); this.libraryList.append(button);
            });
            this.enter(generation);
            await this.preview(this.libraries[0].Id);
            if (!this.valid(generation)) return;
            this.timer = setInterval(() => {
                if (!this.valid(generation)) { this.stop(); return; }
                if (!document.hidden && this.cards?.length > 1 && !this.stage.matches(':hover') && !this.coverList.matches(':hover') && !this.root.contains(document.activeElement))
                    this.select((this.index + 1) % this.cards.length, true);
            }, 6500);
        } catch (error) { if (this.valid(generation) && error.name !== 'AbortError') this.showStatus('媒体库加载失败，请重试。', true); }
    };
    Gallery.prototype.enter = function (generation) {
        this.animations.forEach(animation => animation.cancel());
        const entrance = this.entrance = (this.entrance || 0) + 1;
        const reveal = () => { if (this.valid(generation) && entrance === this.entrance) this.root.classList.add('tg-entered'); };
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !this.nav.animate) { reveal(); return; }
        const pulse = this.root.dataset.style === 'pulse', gallery = this.root.dataset.style === 'gallery';
        this.animations = [
            ...Array.from(this.libraryList.children, (button, index) => button.animate([
                { transform: 'translateY(calc(-100vh - 100%)) rotate(' + (pulse ? '-11' : gallery ? '0' : '-5') + 'deg)', opacity: 0 },
                { transform: 'translateY(0) rotate(0)', opacity: 1 }
            ], { duration: pulse ? 640 : gallery ? 950 : 780, delay: Math.min(index, 3) * 70, fill: 'backwards', easing: 'cubic-bezier(.16,1,.3,1)' })),
            this.rail.animate([{ transform: 'translateX(calc(100vw + 100%))', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: pulse ? 820 : gallery ? 1100 : 940, delay: 100, fill: 'backwards', easing: 'cubic-bezier(.16,1,.3,1)' })
        ];
        Promise.all(this.animations.map(animation => animation.finished)).then(reveal).catch(() => {});
    };
    Gallery.prototype.finishEntrance = function () {
        this.animations.forEach(animation => { if (animation.playState === 'running') animation.finish(); });
        if (this.valid()) this.root.classList.add('tg-entered');
    };
    Gallery.prototype.clear = function () {
        ++this.selection; this.root.classList.remove('tg-ready'); this.hero.disabled = true;
        this.cards = []; this.index = 0; this.heroImages.replaceChildren(); this.title.textContent = ''; this.subtitle.textContent = '';
        this.scenery.removeAttribute('src'); this.ordinal.textContent = '';
        this.coverList.replaceChildren(); this.counter.textContent = '';
    };
    Gallery.prototype.showStatus = function (message, retry = false) { this.message.textContent = message; this.retry.hidden = !retry; this.status.hidden = false; };
    Gallery.prototype.preview = async function (id, refresh = false) {
        if (!this.valid() || (!refresh && this.selectedLibrary?.Id === id && this.cards?.length)) return;
        const library = this.libraries.find(item => item.Id === id); if (!library) return;
        this.requestAbort?.abort(); this.requestAbort = new AbortController();
        const generation = this.generation, signal = this.requestAbort.signal;
        this.selectedLibrary = library; this.clear();
        this.libraryList.querySelectorAll('.tg-library').forEach(button => { const selected = button.dataset.libraryId === id; button.classList.toggle('is-selected', selected); button.setAttribute('aria-current', selected ? 'true' : 'false'); });
        this.railTitle.textContent = library.Name + ' / 最近入库'; this.showStatus('正在载入作品…');
        try {
            const cached = this.cache.get(id);
            const cards = !refresh && cached && Date.now() - cached.at < 60000 ? cached.cards : await this.data.load(library, signal);
            if (!this.valid(generation) || signal.aborted) return;
            this.cache.set(id, { cards, at: Date.now() }); this.cards = cards;
            if (!cards.length) { this.showStatus(library.kind === 'favorites' ? '还没有收藏作品。' : '这个媒体库还没有可展示的作品。'); return; }
            this.coverList.replaceChildren(...cards.map((card, index) => {
                const button = element('button', 'tg-cover'); button.type = 'button'; button.dataset.itemId = card.item.Id; button.dataset.index = index;
                const url = this.data.artwork(card.item, this.root.dataset.style === 'cinema' ? 'poster' : 'cover');
                if (url) { const image = element('img', ''); image.src = url; image.alt = ''; image.loading = 'lazy'; image.draggable = false; button.append(image); }
                button.append(element('span', 'tg-cover-label', card.item.Name)); button.setAttribute('aria-label', '查看作品：' + card.item.Name); return button;
            }));
            this.status.hidden = true; this.select(0, false); this.root.classList.add('tg-ready');
        } catch (error) { if (this.valid(generation) && !signal.aborted) this.showStatus('作品加载失败，请重试。', true); }
    };
    Gallery.prototype.select = function (index, scroll) {
        const card = this.cards?.[index]; if (!card || !this.valid()) return;
        this.index = index; const selection = ++this.selection;
        this.title.textContent = card.item.Name || '未命名作品';
        this.kicker.textContent = this.selectedLibrary.Name + ' / 最近入库';
        const episode = card.latestEpisode;
        this.subtitle.textContent = [card.item.ProductionYear, episode ? '最新入库 · S' + (episode.ParentIndexNumber || 1) + ':E' + (episode.IndexNumber || '?') + ' ' + (episode.Name || '') : '', card.addedAt ? '入库 ' + card.addedAt.slice(0, 10) : ''].filter(Boolean).join('  ·  ');
        this.hero.setAttribute('aria-label', '查看作品：' + this.title.textContent); this.hero.disabled = false;
        this.counter.textContent = String(index + 1).padStart(2, '0') + ' / ' + String(this.cards.length).padStart(2, '0');
        this.ordinal.textContent = this.counter.textContent;
        const covers = this.coverList.querySelectorAll('.tg-cover');
        covers.forEach((button, i) => { button.classList.toggle('is-selected', index === i); button.setAttribute('aria-current', index === i ? 'true' : 'false'); });
        if (scroll && covers[index]) this.coverList.scrollTo({ left: covers[index].offsetLeft - this.coverList.offsetLeft - 3, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        const url = this.data.artwork(card.item, this.root.dataset.style === 'gallery' ? 'poster' : 'hero');
        if (!url) { this.heroImages.replaceChildren(); this.scenery.removeAttribute('src'); return; }
        this.scenery.src = this.data.artwork(card.item, 'hero') || url;
        const image = element('img', 'tg-poster-image'); image.alt = ''; image.draggable = false;
        image.onload = () => {
            if (!this.valid() || selection !== this.selection) { image.remove(); return; }
            this.heroImages.querySelectorAll('img').forEach(prior => { if (prior !== image) prior.remove(); });
            requestAnimationFrame(() => { if (this.valid() && selection === this.selection) image.classList.add('is-visible'); });
        };
        image.onerror = () => image.remove(); image.src = url; this.heroImages.append(image);
    };
    Gallery.prototype.open = function (card) { if (card && this.valid()) this.options.router.showItem(card.item, this.api.serverId()); };
    Gallery.prototype.scrollToBeginning = function () { this.host.scrollTop = 0; this.libraryList.scrollTop = 0; this.libraryList.scrollLeft = 0; this.coverList.scrollLeft = 0; };
    Gallery.prototype.stop = function () {
        this.active = false; ++this.generation; this.abort?.abort(); this.requestAbort?.abort();
        document.body.classList.remove('tg-home-active');
        this.animations.forEach(animation => animation.cancel()); this.animations = [];
        if (this.timer) clearInterval(this.timer); this.timer = null;
        this.selectedLibrary = null; this.cache.clear(); this.clear();
        this.libraries = []; this.libraryList.replaceChildren();
    };
    Gallery.prototype.destroy = function () { this.stop(); this.resizeObserver.disconnect(); this.listeners.forEach(remove => remove()); this.host.replaceChildren(); this.host.classList.remove('tg-home-host'); };
    window.TigerestHomeGallery = Gallery;
}());
