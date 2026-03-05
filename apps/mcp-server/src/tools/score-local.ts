import { scoreLocal } from "./shared.js";

export async function hermesScoreLocal(input: {
  challengeId: string;
  filePath: string;
}) {
  return scoreLocal(input);
}
