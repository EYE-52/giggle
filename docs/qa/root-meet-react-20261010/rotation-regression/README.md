# Meet tablet rotation regression

Reviewed product patch integrated by root as adf55d0. Evidence source was frozen 2a2e0c8, isolated Node24 Next webpack server on4024, ordinary Playwright UI controls and synthetic media (not liveRTC or physical-device acceptance). No production files changed by this archive.

Original768×1024→844×390 failure is retained. Exact control path: mute Maya, adjust fit/zoom/reset, grow, pin, rotate. One of five repeats reproduced mine-2 bottom390.828125 beyond390.5 while the stage reported snapped. A live top transition remained; settled geometry fit at380. Cancellation is limited to positional CSS transitions on participant hosts during ResizeObserver snap; normal grow glide, media identity and focus remain covered.

Original ten-case candidate packet is unchanged: final-with-transition-assert-repeat5.log and final-with-transition-assert-profiles.log. Its reduced-motion claim was incorrect: top-level use.reducedMotion was invalid fixture configuration. property-guard-tsc.log preserves that discovery. Configuration was corrected to contextOptions.reducedMotion; property-guard-reduced-corrected-fixture.log independently passes, and corrected TypeScript log is clean. Final property-guard-targeted.log contains five targeted profile passes. Product guard uses property existence plus String whitelist, not constructor availability.

Candidate profiles starting at exactly844×390 caused a no-resize diagnostic timeout, preserved in candidate-profiles.log. Meaningful landscape844×400→844×390 rerun passed. The600ms diagnostic wait in early reproduction only observes settled geometry; final two-frame tests contain no relaxed timeout or delay. No heard audio, live provider, physical smoothness or immutable native loaded-hash claim.

Screenshots retain actual synthetic stream pixels. No traces/videos/dependencies/auth packets included. manifest.json hashes every archived file except itself. Root native inspection is archived separately; supported CUA did not expose getAnimations.

Screenshot provenance: results/ contains final guarded tablet repeat pixels; candidate-landscape-resize/ contains corrected reduced-motion final-guard pixel. candidate-profiles/ retains earlier constructor-guard profile pixels and the same-size landscape fixture failure, not final-guard or correctly configured reduced-motion acceptance.
