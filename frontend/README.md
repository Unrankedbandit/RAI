# RAI — frontend

An AI due-diligence copilot for solar capital projects. RAI reads a
project's document set, scores how close it is to activation across five risk
pillars (Land, Law, Finance, Materials, Demand), surfaces cross-document
contradictions, and recommends next actions — every claim traceable to a source.

Built with **Next.js 16 (App Router) · TypeScript · Tailwind v4 · Framer Motion**.
The UI runs entirely on a mock data layer behind a clean data contract, so the
backend can swap in real agent output without touching component code.

## Getting started

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000.

## Scripts

- `npm run dev` — dev server (Turbopack)
- `npm run build` — production build + typecheck
- `npm run start` — serve the production build
- `npm run lint` — ESLint

## Where things live

```
src/
├── app/                      # routes (App Router)
│   ├── page.tsx              # Home — drop-in, portfolio stats & charts
│   ├── projects/             # Current Projects portfolio + /[id] project view
│   │   └── [id]/             # Overview, chat, reports, documents, map, timeline
│   ├── scanning/             # animated document-scan state
│   └── settings/
├── components/
│   ├── ui/                   # shared primitives (Card, StatusPill, DonutRing…)
│   ├── project/              # project shell: context, sub-nav, header actions
│   ├── evidence/             # shared evidence drawer (single + contradiction)
│   ├── overview/ portfolio/ home/ scanning/ assistant/ timeline/
└── lib/
    ├── types.ts              # the data contract
    ├── mockData.ts           # mock data grounded in the sample document set
    └── band.ts               # risk-band → styling/copy (keeps color meaningful)
```

## Design system (enforced)

- **Type:** Poppins, weights 400/500/600 only — semibold is the maximum.
- **No icons.** Communicates through type, weight and color only.
- **White canvas**, 18/12/8px radii, fully-rounded pills, soft elevation,
  hairline dividers, sentence case throughout.
- **Two separate palettes:** a brand palette for structure (orange, vista bleu,
  amande, oxford ink) and a distinct, muted **status** palette reserved
  exclusively for risk bands (green / amber / red). They are never crossed —
  color always encodes a status, category, or selection.

## Data contract

Components consume the shapes in `src/lib/types.ts` as props — nothing is
hardcoded inside components. Replace the exports in `src/lib/mockData.ts` with
real backend output against the same contract and the UI updates unchanged.
