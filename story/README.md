# Qubu story

> A short Slidev deck about why Qubu treats SQL as composable pieces and schema change as something you can inspect before you run it.

This story uses [Slidev](https://sli.dev), Anthony Fu's Markdown-first slide
tool. The deck is self-contained: `slides.md` holds the narrative and
`style.css` holds the visual language.

## Run it locally

```bash
cd story
pnpm install
pnpm dev
```

Open the local URL Slidev prints. Use the presenter view when you want notes,
timing, and a second window for the audience.

## Build or export

```bash
pnpm build
pnpm export
```

`pnpm build` writes a hostable static deck to `story/dist`. `pnpm export`
creates a PDF through Slidev's browser-backed exporter.
