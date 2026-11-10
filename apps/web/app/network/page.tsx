import { LabPage, labMetadata, type LabSearchParams } from "@/components/LabPage";

export const generateMetadata = () => labMetadata("network");

export default function Page({ searchParams }: { searchParams: LabSearchParams }) {
  return <LabPage lab="network" searchParams={searchParams} />;
}
