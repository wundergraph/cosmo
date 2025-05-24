import { useRouter } from "next/router";
import { clamp } from "@/lib/utils";

export const usePaginationParams = () => {
  const router = useRouter();
  const pageNumber = Math.max(Number.parseInt((router.query.page as string) || "1"), 1);
  const pageSize = clamp(Number.parseInt((router.query.pageSize as string) || "20"), 10, 50);
  const offset = (pageNumber - 1) * pageSize;
  const search = (router.query.search as string) || "";

  return {
    pageNumber,
    pageSize,
    offset,
    search,
  } as const;
};