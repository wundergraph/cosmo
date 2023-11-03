import { useRouter } from "next/router";

export const useRange = () => {
  const router = useRouter();

  const range = router.query.range
    ? parseInt(router.query.range?.toString())
    : 24;

  switch (range) {
    case 24:
      return 24;
    case 72:
      return 72;
    case 168:
      return 168;
    case 720:
      return 720;
    default:
      return Math.min(24, range);
  }
};
