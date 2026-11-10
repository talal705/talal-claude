import { SimplePcLab } from "@/components/pc/SimplePcLab";
import { LabPage, labMetadata, type LabSearchParams } from "@/components/LabPage";

export const generateMetadata = () => labMetadata("pc");

export default async function Page({ searchParams }: { searchParams: LabSearchParams }) {
  // Retain access to old saved builds without putting the detailed workspace in the new flow.
  const query = await searchParams;
  if (query.advanced === "1") return <LabPage lab="pc" searchParams={Promise.resolve(query)} />;
  return <SimplePcLab />;
}
