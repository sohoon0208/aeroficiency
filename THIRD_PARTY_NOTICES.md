# Third-party notices

Aeroficiency's own source and original visual assets are licensed under MIT. The application also depends on open-source packages installed from npm. Exact versions and transitive dependencies are locked in `package-lock.json`; this file summarizes direct dependencies and does not replace their license texts. The frozen non-development dependency inventory is preserved in `THIRD_PARTY_LICENSES/npm-production-inventory.md`, and installed root license/notice documents are preserved in `THIRD_PARTY_LICENSES/npm-production-license-texts.txt`. Both are copied into the production asset tree.

| Package | License |
|---|---|
| React, React DOM, React Server DOM Webpack | MIT |
| Next.js | MIT |
| Vinext | MIT |
| Vite and Vitest | MIT |
| Three.js | MIT |
| React Three Fiber and Drei | MIT |
| Zustand | MIT |
| Zod | MIT |
| OpenAI Sites Vite plugin | MIT |
| Cloudflare Vite plugin | MIT |
| Wrangler | MIT OR Apache-2.0 |
| Cloudflare Workers types | MIT OR Apache-2.0 |
| TypeScript | Apache-2.0 |
| ESLint and ESLint Config Next | MIT |
| Tailwind CSS PostCSS tooling | MIT |
| Testing Library and jsdom | MIT |
| Geist and Geist Mono build-output fonts | SIL Open Font License 1.1 |

The remaining direct type and build packages listed in `package.json` are MIT-licensed as reported by their installed package metadata.

## Assets and technical references

- `public/favicon.svg` is an original Aeroficiency vector mark created for this project.
- `public/og.png` is an original project preview created with OpenAI ImageGen under the entrant's direction; it contains no third-party logo or stock image.
- The UI requests local system font stacks and fetches no remote font. Vinext currently emits local Geist and Geist Mono files in the production bundle; their upstream copyright and full SIL OFL 1.1 terms are preserved in `THIRD_PARTY_LICENSES/Geist-OFL-1.1.txt` and copied into the deployed asset tree from `public/THIRD_PARTY_LICENSES/Geist-OFL-1.1.txt`.
- NACA four-digit coordinates are computed from the documented public-domain equations rather than copied from a dataset.

Technical references inform the model and testing methodology; their text, figures, data, and code are not redistributed. The current model boundary and reproducibility guidance are summarized in [Engineering model and assumptions](README.md#engineering-model-and-assumptions) and [Testing and reproducibility](README.md#testing-and-reproducibility).

Run `npm run licenses:generate` whenever the lockfile changes and `npm run licenses:check` at every release gate. The generated inventory conservatively includes the full locked production graph and always classifies lockfile-declared optional platform packages from lock metadata, independent of which optional packages are installed on the build machine.
