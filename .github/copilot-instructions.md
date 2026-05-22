<!-- Copilot instructions tailored for this repository -->

- **Project type:** Vite + React + TypeScript single-page app.
- **Primary commands:**
  - Install deps: `npm install`
  - Dev server: `npm run dev`
  - Build: `npm run build` (runs `tsc -b && vite build`)
  - Preview build: `npm run preview`
  - Lint: `npm run lint`
- **Key files:** `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `src/main.tsx`, `src/App.tsx`, `index.html`, `public/`.
- **Conventions & notes:**
  - TypeScript + Vite + React 19; Tailwind is present.
  - PWA support via `vite-plugin-pwa`.
  - Use `npm` (or `npm ci` for CI) and the scripts in `package.json` for reproducible tasks.
  - There are no test scripts configured in `package.json`.
  - Prefer small, focused changes; open a PR to `main` for non-trivial work.
- **What an agent should do first:**
  - Run `npm ci` then `npm run dev` to reproduce the dev environment.
  - Run `npm run build` to validate production build.
  - Run `npm run lint` for style checks.
  - Link to repository docs rather than duplicating content: see [README.md](README.md).

If you want, I can also add an `AGENTS.md` with short task-specific agents (frontend, build, lint). Request that and I'll scaffold it.