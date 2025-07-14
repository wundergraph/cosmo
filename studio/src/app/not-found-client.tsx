"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function NotFoundClient() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // back to previous page
          router.back();

          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [router]);

  return (
    <span>
      Redirecting you back to last page in {countdown} second
      {countdown !== 1 ? "s" : ""}...
    </span>
  );
}
