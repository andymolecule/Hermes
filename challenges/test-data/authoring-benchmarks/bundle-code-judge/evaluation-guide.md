# Evaluation Guide

Expected compile outcome:
- state: `rejected`
- no official table template is chosen
- the submission contract stays conceptually opaque `.zip` bundle oriented
- the failure points the poster toward the explicit custom scorer workflow

Why it stays typed-only:
- the draft is deterministic enough to type
- the bundle packaging is clear enough to infer
- the repo does not yet have a constrained execution template for arbitrary bundle judges

What the guided flow should clarify:
- what files must be present in the submitted bundle
- how the hidden rubric or judge determines a score
- which artifacts are visible to solvers and which stay hidden
- reward, distribution, and submission deadline details if omitted

What counts as a pass:
- no official table template is chosen
- no ML-specific artifact roles leak into the draft
- the bundle submission contract expectations remain `.zip` / `application/zip`
- the draft fails cleanly instead of pretending it is executable
