export type Challenge = {
  id: string;
  title: string;
  description: string;
  domain: string;
  status: string;
  reward_amount: number | string;
  deadline: string;
  challenge_type: string;
  submissions_count?: number;
  dataset_train_cid?: string | null;
  dataset_test_cid?: string | null;
  scoring_metric?: string | null;
  scoring_container?: string | null;
  dispute_window_hours?: number | null;
  minimum_score?: number | string | null;
  created_at?: string;
};

export type Submission = {
  id: string;
  on_chain_sub_id: number;
  solver_address: string;
  score: string | null;
  submitted_at: string;
};

export type ChallengeDetails = {
  challenge: Challenge;
  submissions: Submission[];
  leaderboard: Submission[];
};

export type Stats = {
  challengesTotal: number;
  submissionsTotal: number;
  scoredSubmissions: number;
};
