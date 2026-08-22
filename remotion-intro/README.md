# Qubu intro video

A 30-second Remotion intro for Qubu. The same React composition adapts its layout for YouTube landscape and mobile portrait output.

## Preview

```sh
npm install
npm run preview
```

The Remotion Studio lists both compositions:

- `QubuIntroLandscape`: 1920 × 1080
- `QubuIntroPortrait`: 1080 × 1920

## Render

```sh
npm run render:youtube
npm run render:mobile
```

Videos are written to `out/`. To export matching cover images, run `npm run render:stills`.

## Timing and content

The composition runs for 900 frames at 30 fps. Each scene owns a single part of the story: composition, type tracking, dialect rendering, the driver boundary, and the install prompt. Edit scene durations in `src/QubuIntro.tsx` and keep the total aligned with `durationInFrames` in `src/Root.tsx`.
