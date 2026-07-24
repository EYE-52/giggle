# Giggle UI/UX Enhancement Roadmap

This document outlines the visual and interactive evolution of the Giggle platform, focusing on premium aesthetics and user engagement.

## Phase 1: Semantic Design & Accessibility
*Goal: Ensure a consistent and inclusive experience.*

### 1.1 Robust Dark Mode (Urgent)
- Fix all hardcoded text colors (`text-black`, `text-gray-900`) to use semantic classes (`text-foreground` or `text-gray-900 dark:text-gray-100`).
- Audit contrast ratios for sidebar items and input placeholders.

### 1.2 Unified Component Library
- Standardize "Card," "Button," and "Input" styles using Tailwind's `@apply` or consistent class sets.
- Implement a global "Glassmorphism" effect for overlays (Lobby controls, Reveal countdown).

---

## Phase 2: Feedback & "Aliveness" (COMPLETED)
*Goal: Make the interface feel responsive and active.*

### 2.1 Audio Visualizers (COMPLETED)
- Added dynamic "Voice Rings" around Video Tiles.
- Tiles now pulse and glow (emerald) when a user is detected speaking.

### 2.2 Micro-Interactions (COMPLETED)
- Integrated **Framer Motion** for all core UI transitions.
- Smooth layout animations for squad member entry/exit.
- Spring-based tactile feedback for all lobby control buttons.
- Animated high-energy countdown for squad collisions.

---

## Phase 3: Premium Reveal UX (COMPLETED)
*Goal: Elevate the "Collision" moment.*

### 3.1 Advanced Reveal Overlay (COMPLETED)
- Created a high-energy "Squad Collision" sequence.
- Squad names fly in from opposite sides and meet in the center during the countdown.
- Added a floating "VS" badge with a spring-based scale animation.

### 3.2 Dynamic Backgrounds (COMPLETED)
- Implemented a global radial-gradient background that shifts colors based on squad "Vibe Tags."
- Supports unique color signatures for #Gaming, #Music, #Party, etc.
- Transitions smoothly between vibe states using Framer Motion.
