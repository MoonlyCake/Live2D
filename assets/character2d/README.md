# Blue whale maid · ordinary 2D artwork

Production raster art for the whale desktop pet. The visual identity follows the five supplied character references: long indigo-to-ocean-blue hair, white pearl/lace headband, navy-and-white fin ornaments, navy/white/gold maid costume, blue-whale apron and whale fluke tail.

## Shipping files

- `body.png`: 1254 × 1254; relaxed neutral full-body pose
- `moods-atlas.png`: 1536 × 1024; 3 columns × 2 rows; happy, shy, aggrieved, sleepy, unimpressed, blink
- `rice-atlas.png`: 1254 × 1254; 2 × 2; holding white rice, spoonful at mouth, puffed-cheek chewing, caught hiding bowl
- `interaction-atlas-v2.png`: 1254 × 1254; 2 × 2; typing, alternate typing, left dance, right dance
- `manifest.json`: canonical source rectangles and registration consumed by the renderer

All files are generated RGBA PNGs. Keep the alpha channel. The mood atlas has non-black RGB data underneath fully transparent pixels; an image viewer that ignores alpha may misleadingly show a blue-gray backdrop. The actual background alpha is zero. Character pixels are mostly alpha 253–254, with soft antialiased edges. There is no baked opaque rectangular backdrop.

## Runtime contract

Read `manifest.json`, not atlas ordering guesses. Each `sprites` entry has a local PNG `file`, optional exact `[x, y, width, height]` source `rect`, optional normalized `offset`, and optional `scale`. `design` is a square 1254-unit artwork space. Baselines and visible silhouette height are registered against the neutral pose. The `wave` sprite aliases the happy welcoming pose.

The interaction atlas deliberately includes spacious transparent gutters. Its manifest rectangles crop each individual pose within its own quadrant. There is no runtime image rewriting or background removal. The neutral opaque silhouette begins 3 pixels below the source top; leave renderer motion margins around the artwork.

The four-frame rice sequence is specifically plain white steamed rice in a blue-and-white ceramic whale bowl with a spoon. The chewing and caught poses include a visible white rice grain beside the mouth. Do not replace the bowl with a cookie or snack icon.

Suggested idle animation: slow breathing, gentle hair/tail deformation, cursor-directed upper-head movement, periodic blink sprite. Suggested interaction animation: alternate typing poses while keyboard events are active, alternate dance poses to detected audio energy, and sequence eat → bite → chew with caught selected on resumed activity. These are ordinary illustrated 2D poses animated by the application.

## Provenance and verification

Created with the built-in image generation tool using the supplied visual references. `generation-prompts.json` records the exact prompt set. `asset-quality.json` records inspected dimensions, alpha coverage, source rectangles, and silhouette bounds. Only the selected images listed above are part of the final artwork.

This artwork is not a Cubism mesh, `.moc3` model, layered PSD, or native Live2D source. The separate Live2D development edition must load an actual compatible model when one is supplied.
