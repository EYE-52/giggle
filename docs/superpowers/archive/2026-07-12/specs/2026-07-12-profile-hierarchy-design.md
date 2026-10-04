# Profile Responsive Hierarchy Design

## Problem

Profile settings are coherent on desktop, but phone and tablet stack a large identity card and a separate Giggle+ card before any editable settings. The duplicate surfaces consume the first fold without adding information.

## Design

- Keep the existing Vibes, About You, and Account settings form unchanged.
- Combine avatar, display name, and the single Giggle+ status/upsell into one identity surface.
- Use a compact horizontal avatar/name row on phones.
- Use a `240px / flexible` two-column layout on tablets and the existing `300px / flexible` layout on desktop.
- Keep the profile visually quiet; do not add decorative gradients or new navigation.
- Raise the demographics Save action to the shared 44px target baseline.

## Acceptance Criteria

- Phone reaches Vibe Preferences materially earlier than the current layout.
- Tablet shows identity beside settings without horizontal overflow.
- Desktop preserves its clear identity/settings split.
- Exactly one Giggle+ status or upsell is rendered.
- Avatar editing, premium routing, profile persistence, account switches, and sign-out behavior remain unchanged.
