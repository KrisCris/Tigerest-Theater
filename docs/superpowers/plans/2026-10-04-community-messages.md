# Community Messages and High Refresh 2.4 Implementation Plan

> Use superpowers:executing-plans inline; final whole-change review follows verification.

**Goal:** Finish deployed message API integration, improve Windows high refresh playback, deliver 2.4.0.
**Architecture:** Account-scoped message client, separate detail Item authorization; native synchronization policy before RIFE lifecycle policy; preserve system/custom overrides.
**Tech Stack:** JavaScript DOM/Node/Chromium/QtWebEngine, Qt C++/CMake/CTest, Windows packaging.
**Spec:** `docs/superpowers/specs/2026-10-04-community-messages-design.md`, revision 2026-10-05; `docs/community-api.md`.

## Global Constraints
- Continue existing codex/community-message-center working changes; preserve unrelated drafts.
- Tokens never enter URLs, logs, static bundles or browser storage.
- Do not write test comments or change production read state during validation.
- No refresh-rate changes persist after playback testing. Preserve manual/system configuration.

## Review Focus
- Account changes, delayed responses, tab races, unavailable content and service outages.
- Snapshot freshness must not mark later notifications read; use opaque IDs and authorization.
- Anchor and cursor are mutually exclusive; continuation uses returned cursors.
- High refresh policy must not defeat explicit audio, system mpv.conf, RIFE restoration, or normal refresh rates.
- Packaged scripts and settings must match tested source; no private backend code or credentials.

### Task 1: Request contract
- [x] Baseline 10/10; replace guessed API tests with deployed paths/payloads; observe 3 failures.
- [x] Implement /me APIs and anchors; 11/11 Node tests pass.
- [x] Synchronize formal API document.

### Task 2: Message UI and navigation
- [x] Exercise deployed-shaped fixtures; observe received reply context failure.
- [x] Implement read snapshots, placeholders, transient-error retention, authorized anchor pages; Chromium passes.
- [x] Complete outage/race/deleted-anchor regression cases and QtWebEngine verification.

### Task 3: High refresh compatibility
- [x] Add policy tests; observe failure; implement opt-out Windows >120 Hz audio-clock adaptation.
- [x] Verify settings changes, monitor changes, RIFE lifecycle, override boundaries and native tests.
- [x] Record root-cause evidence and full-client 240 Hz playback results without overstating cause.

### Task 4: Version and delivery
- [x] Update VERSION/CHANGELOG/README to 2.4.0.
- [x] Run relevant Node, CTest, browser and bundle regressions; build installer and portable ZIP.
- [x] Fresh whole-change review and fixes, final artifact checks and report.

## Decisions
The deployed private backend already owns the admin website on LAN 18444. Existing untracked web/admin drafts remain untouched and are not part of the 2.4 client release. Existing in-progress branch is the continuation workspace; no main/master edits or new competing checkout.
