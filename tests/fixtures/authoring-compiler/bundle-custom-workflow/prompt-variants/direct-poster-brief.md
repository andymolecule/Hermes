# Bundle Judge For Deterministic Transform

We want solvers to submit one zip bundle containing a small deterministic transform pipeline.

They should use the public inputs bundle as the visible input surface. Agora should judge the submitted bundle against a hidden rubric that checks required files, output shape, and deterministic behavior. Highest deterministic judge score wins.

This should not be a prediction challenge. It is a packaged work-product challenge with an explicit rubric.
