# Primary Meet layout review — 10 October 2026

The primary reviewer used ordinary controls in the actual Lobby, Encounter and Sign-in React routes in Chrome. These temporary loopback environments use synthetic session, squad, socket, game-frame and media SDK data. They do not establish production authentication, live embedded multiplayer, physical device input or RTC.

Production had two separately reproduced defects: at 568×320 the game iframe height was zero, and at 768×1024 opening Chat squeezed it to 100 pixels wide. The reviewed source over `origin/main` `1602b32f65ddabed1aa35f905bc51dd0ccb9a855` repairs those layouts and keeps controls accessible.

| Primary native review | Observation |
| --- | --- |
| Lobby 568×320 Auto / Compact | Game iframe 392×160 / 428×160; Close, Chat and Find a squad hit-test reachable |
| Lobby 768×1024 Chat | Chat 720×828; iframe remains connected while hidden, restores after Close chat |
| Encounter 568×320 Auto | Game iframe 334×176; 44px Close, 48px Chat and Leave controls reachable |
| Encounter 768×1024 Chat | Full chat stage; closing restores 534×820 Auto game frame |
| Encounter unavailable Games | Retry and Close remain reachable; Retry preserves unavailable status; closing restores call |
| Lobby phone Floating | Large game frame, readable voice prompt, Dismiss and floating call controls reachable |
| Production Sign-in 390×844 | 308×48 Google action reachable; no development account action, no horizontal overflow |
| Production Sign-in 568×320 | 438×48 Google action in viewport; normal vertical document scroll, no horizontal overflow |

The dev route was reviewed first. The separate default Turbopack production build was then reviewed for Lobby, Encounter and Sign-in. The primary reviewer independently compared all 14 compiled CSS files and the ordered CSS content hashes emitted for those three routes against the clean release candidate: identical. See `root-production-css-review.json`.

Only three source files differ in the production review fixture: root layout loads its synthetic SDK; Next CSP and Games URL parsing allow its exact local fixture origin. Those exceptions remain outside the release candidate. No production credentials, cookies or media were copied. Camera and microphone were not enabled during primary review.

Screenshots beginning `prod-css-` show production compiled styles. The white child iframe explicitly labels itself as a synthetic geometry fixture; it is not game design. `signin-first-desktop-clip.png` preserves an initial incorrectly sized screenshot attempt: the newly created tab reset the viewport to 1144×782, so its 390×844 crop is not phone evidence. The subsequent phone screenshot follows an explicit 390×844 viewport and geometry observation.

All owned browser tabs were closed, viewport override reset and temporary servers stopped after ownership checks. Original cleanup helpers refused `/tmp` versus `/private/tmp` path spelling; primary cleanup verified exact commands, canonical working directories and process groups before stopping them. No user sessions or unrelated processes were stopped.

These checks accept the scoped layout and sign-in presentation changes. Physical phones/tablets, soft keyboards, Safari and two real participants with live Giggle Meet media remain pending. Full catalogue game acceptance remains separate.
