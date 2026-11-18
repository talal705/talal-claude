import { PcBuilder } from "@/components/pc/PcBuilder";
import { LabPage, labMetadata, type LabSearchParams } from "@/components/LabPage";
import { isTutorAiConfigured } from "@/lib/server/tutor/providers";

export const generateMetadata = () => labMetadata("pc");

export default async function Page({ searchParams }: { searchParams: LabSearchParams }) {
  // Retain access to old saved builds without putting the detailed workspace in the new flow.
  const query = await searchParams;
  if (query.advanced === "1") return <LabPage lab="pc" searchParams={Promise.resolve(query)} />;
  return <PcBuilder aiConfigured={isTutorAiConfigured()} />;
}
