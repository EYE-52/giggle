# Canonical Games integration

The sole source of truth is `EYE-52/giggle`. This component was consolidated
into `apps/games` from reviewed committed historical inputs, not dirty
working trees:

- Canonical Meet base: `12e807989c8d8e0fea3ed3858c709d0f149008bf`.
- Games release fixes: `589028426aad5d414b0d62bfa896c1b3d97ee4ab`,
  descending from historical main `2139e73a43a1ea1c2e1082fb3fe2de71b015139f`.
- Compact UI delta: `5da48aa8a908cc9b90a9b2c61b29553e1dc7c700` through
  `24785078099ff451ac703370ce9e30dc6bd9003a`. Its changed paths do not
  overlap the release-only change after the common base.

Historical QA archives and deployment reports are not imported as current
release evidence. One camera-route JSON assertion fixture is retained in
`test/fixtures`. Licensed runtime assets and editable asset provenance are
retained. No original dirty checkout was edited. The newer Meet routes,
call ownership, aliases, safety policy and UI remain the canonical versions;
unavailable older Meet commit `7f897421ed5226c2840c4bb9fc25ef624361219e`
was not reconstructed or claimed present.

## Local checks

Use Node 22.13.0 / pnpm 10.33.0 for the root apps, and Node 24 / npm for
this component. Install the root with `pnpm install --frozen-lockfile`,
`server` with `npm ci --prefix server`, and Games with
`npm ci --prefix apps/games`. Run root `pnpm test`, `pnpm typecheck`,
`pnpm build:desktop`, `npm --prefix server test`, `npm run test:games`,
`npm run test:games:integration` and `npm run build:games`. API tests require
local Redis; full app smoke and deploy-bundle verification additionally
require a local MongoDB replica set and synthetic local configuration.
The optional compact/landscape browser scripts use local rooms only and
must retain strict console checks. Physical media acceptance remains separate.

The bridge retains optional validated signed encounter side metadata;
this does not add squad-vs-squad engine rules. Standalone rooms are unchanged.

## Release identity and hosting

The release stamp identifies the canonical root Git commit and the
component's deterministic runtime bytes. Stamp only a clean canonical
checkout after building; a change anywhere in the repository blocks it.
Meet API/web and Games backend/frontend keep existing hosting boundaries.
Games must retain one Singapore replica, zero overlap and `/data` reports
volume. Backend success and exact deployment ID plus matching source/build
are required before its frontend. A restart loses in-memory game rooms.

No production source, config, credential, grant or infrastructure changes
are part of this local integration. Owner security confirmation, provider
authorization, current topology, incident clearance and fresh rollback
identity verification remain production gates.
