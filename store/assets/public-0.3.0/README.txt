FamCall 0.3.0 — English public store assets

Six screenshots per platform, the Play feature graphic, and campaign formats.
Native app screens were captured from the 0.3.0 UI in isolated iOS/Android E2E
builds using demo-famcall and fictional contacts/history. Screens are genuine;
these captures do not establish production calling, authentication or push delivery.
The app source matches 914112a72d93c23399613661379ded6d150ddb0c. The illustration
is AI-generated editorial photography, not a customer testimonial. Marketing layout,
copy and icon work used AI assistance; the assets are labeled accordingly in Play.
This label does not mean the genuine captured app screens are fabricated.

Screenshot and campaign exports are opaque RGB PNGs. The Play icon is a 32-bit
RGBA PNG with an opaque alpha channel. manifest.json records dimensions and SHA-256 hashes.
Store text remains English; the app itself supports 12 languages with LTR layouts.
Original FamCall artwork keeps the approved forest green, cream and sage palette.
No APK badge or direct APK download is included. Official store badges appear on
the website only after a hosting deployment verifies their public store pages.

Render: FAMCALL_ASSET_TOOLS=<local tools folder> node store/release/render-assets.cjs
Validate: python3 store/release/prepare_metadata.py && node scripts/prepare-store-drafts.mjs
