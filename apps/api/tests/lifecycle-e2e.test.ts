import test from "node:test";
import { canRunLifecycleE2E, runLifecycleE2E } from "../src/e2e-test.js";

test(
  "Open -> startScoring -> postScore -> public verify -> dispute -> resolve -> claim",
  { skip: !canRunLifecycleE2E() },
  async () => {
    await runLifecycleE2E();
  },
);
