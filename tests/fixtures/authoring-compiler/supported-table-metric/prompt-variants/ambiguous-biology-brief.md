# Ambiguous Biology Brief

We have a targeted therapy screening dataset across multiple cancer cell lines.
One file contains the experiments we already measured, another file contains a
holdout screen with the response column removed, and the last file contains the
truth values that should stay hidden for scoring. We want the community to model
drug sensitivity for the held-out experiments and return one prediction per row.

The poster is interested in the best predictive fit on the hidden response
values, but the brief intentionally does not start in leaderboard or metric
language.
