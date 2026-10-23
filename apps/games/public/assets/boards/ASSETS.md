# Chessmen and flat boards

All files in this directory are original Giggle assets authored for this
project. No publisher pieces, extracted game art, photographs or trademark
marks are included. The generated game targets informed the material
direction; they are not sliced or stretched into a playable interface.

`chess/{w,b}{p,n,b,r,q,k}.webp` are twelve transparent 256px renders of
original Blender meshes. Both sides use the same physical profiles, camera,
scale and softbox lighting. The knight is a beveled carved silhouette;
turned pieces have lathed rings, rook battlements, queen crown beads,
a bishop's carved slit and the king's cross. Authoring source is
`assets-source/boards/chess/build-pieces.py`. Run with the installed official
Blender application, then run `python3 assets-source/boards/chess/encode-pieces.py`
to encode quality-94 WebP with unchanged lossless alpha silhouettes. The
encoder validates dimensions, clipping and the 100KB set budget. The total
sprite payload is approximately 64KB. The meshes are an
offline art tool; browsers need no Blender or extra 3D dependency.

Boards are flat: squares, racks, bowls, charts and trails are drawn as
inline SVG or CSS in flat colours, so they read the same in the Day, Night
and Inside Giggle looks. The earlier wood, stone and cloth texture samples
are no longer shipped; chess piece sprites are the only board bitmaps.

Chess squares and legal targets are live DOM buttons. Four in a Row's rack,
holes, counters and hit columns are live SVG. Reversi's inlays, legal dots,
discs and hit cells are live SVG. Game-state snapshots and existing server
authority determine every board position. Selection and animation never
change the authoritative game state.
