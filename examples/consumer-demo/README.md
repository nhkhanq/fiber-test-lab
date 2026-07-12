# consumer-demo

A mock Fiber project that **consumes `fiber-test-lab` as a dependency** to test its own scenarios —
demonstrating the test-kit as reusable infrastructure.

It depends on the package (`"fiber-test-lab": "link:../.."`), defines its **own** scenario YAML files in
`scenarios/`, and writes Vitest tests that import the assertions:

```typescript
import { setupScenario, expectPaymentSucceeds, expectPaymentFails } from "fiber-test-lab/test-kit";

const ctx = await setupScenario("./scenarios/shop-checkout.yaml");   // this project's own scenario
await expectPaymentSucceeds(ctx);
await ctx.reset();
```

## Run

```bash
# 1. Build the package tarball from the repo root (this consumer depends on it):
cd ../.. && npm pack && cd examples/consumer-demo

# 2. Install and run:
npm install       # installs the fiber-test-lab tarball + its dependencies
npm test          # spins up each scenario in Docker and asserts (node:test + tsx)
```

Prerequisites: Docker + Node ≥ 20 (same as the package). Tests run with `node --import tsx --test` so the
package (shipped as TypeScript) and `@ckb-ccc/*` load natively — no bundler transform needed.
