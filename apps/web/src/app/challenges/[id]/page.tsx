import { DetailClient } from "./DetailClient";

export default function ChallengeDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <DetailClient id={params.id} />;
}
