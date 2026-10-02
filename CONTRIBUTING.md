# Contributing

Thanks for helping improve Quantlys Meeting.

## Ground rules

- **No secrets** in PRs — use `.env.example` for new variables, never real keys.
- Keep the **Conclave boundary**: do not vendor or call closed Quantlys platform APIs from this repo.
- Prefer small, focused PRs with a short “why” in the description.

## Dev loop

```bash
cp .env.example .env.local   # your keys
npm install
npm test                     # lib/*.test.mjs + audit/maya_*.mjs
npm run dev
```

Node **22+** recommended so tests can import TypeScript routes with type stripping.

## Tests

- `lib/*.test.mjs` — pure decision guards, no network
- `audit/maya_*.mjs` — route-level suites with a fake cloud (`audit/fake-cloud.mjs`)

Add or extend a guard when you change behavior that users depend on (guest join, hosting probes, PRD shape, etc.).

## Style

Match the file you touch. Product copy should stay honest (no fake metrics, no “one-click Conclave” claims).
