import { Logo } from "@/components/logo";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import Link from "next/link";

const ErrorFallback: React.ReactElement = (
  <div className="flex h-screen items-center justify-center">
    <svg
      width="855"
      height="323"
      viewBox="0 0 855 323"
      fill="none"
      className="absolute hidden md:block md:scale-50 lg:scale-75"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <clipPath id="clip0_702_186">
          <rect
            width="854.167"
            height="322.888"
            fill="white"
            transform="translate(0.5 0.0560303)"
          />
        </clipPath>
      </defs>
    </svg>
    <EmptyState
      icon={
        <div className="md:hidden">
          <Logo height={50} width={50} />
        </div>
      }
      title="An unexpected error occurred"
      description="Sorry, something went wrong. Please try again later or return to the home page."
      className="z-50 md:-mt-8"
      actions={
        /**
         * uses onClick={() => (window.location.href = "/") to go back to home
         * The Link exists for the button styling
         */
        <Button onClick={() => (window.location.href = "/")} asChild>
          <Link href={"/"}>Take me home</Link>
        </Button>
      }
    />
  </div>
);

export default ErrorFallback;
