import React from "react";
import Link from "next/link";
import { Cross2Icon } from "@radix-ui/react-icons";
import { Button } from "../ui/button";
import { MdArrowOutward } from "react-icons/md";
import { useNewFeaturesPopupDisabled } from "@/hooks/use-new-features-popup-disabled";

export default function NewFeaturesPopup() {
  const [isPopupDisabled, setDisablePopup] = useNewFeaturesPopupDisabled();

  const handleClosePopup = () => {
    setDisablePopup("true");
  };

  // Don't render the popup if it's been dismissed
  if (isPopupDisabled) {
    return null;
  }

  return (
    <div className="group relative w-[195px] overflow-hidden rounded-lg p-[1px] before:absolute before:inset-0 before:z-[-1] before:rounded-lg before:bg-gradient-to-r before:from-[hsla(271,91%,65%,1)] before:to-[hsla(330,81%,60%,1)] before:content-['']">
      <div className="relative z-10 flex h-full w-full flex-col items-start justify-center gap-4 rounded-lg bg-card p-3">
        <div className="flex w-full flex-col gap-1.5">
          <div className="flex w-full items-start justify-between">
            <h2 className="text-base font-semibold leading-tight text-card-foreground">
              Cosmo Connect
              <br />
              is here!
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 cursor-pointer text-muted-foreground opacity-0 transition-all duration-300 group-hover:opacity-100"
              onClick={handleClosePopup}
            >
              <Cross2Icon />
            </Button>
          </div>
          <p className="text-sm leading-snug text-muted-foreground">
            A new way to unify your
            <br />
            API ecosystem
          </p>
        </div>
        <Link
          href="https://wundergraph.com/connect"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-x-1 text-sm font-medium text-card-foreground hover:underline"
        >
          Learn more
          <MdArrowOutward className="h-4 w-4" />
        </Link>
      </div>
      <div className="pointer-events-none absolute left-4 top-4 z-40">
        <svg
          width="172"
          height="112"
          viewBox="0 0 172 112"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="text-foreground"
        >
          <g opacity="0.4" clip-path="url(#clip0_354_8)">
            <path
              d="M167.149 98L167.334 98.2697L167.647 98.3621L167.448 98.6212L167.457 98.948L167.149 98.8385L166.841 98.948L166.85 98.6212L166.651 98.3621L166.964 98.2697L167.149 98Z"
              fill="currentColor"
              fill-opacity="0.4"
            />
            <path
              d="M158.193 48L158.393 48.2922L158.733 48.3924L158.517 48.6732L158.527 49.0273L158.193 48.9086L157.859 49.0273L157.869 48.6732L157.653 48.3924L157.993 48.2922L158.193 48Z"
              fill="currentColor"
              fill-opacity="0.6"
            />
            <path
              d="M148.404 36L148.679 36.4009L149.145 36.5383L148.849 36.9236L148.862 37.4094L148.404 37.2466L147.946 37.4094L147.96 36.9236L147.663 36.5383L148.129 36.4009L148.404 36Z"
              fill="currentColor"
              fill-opacity="0.4"
            />
            <path
              d="M134.415 48L134.694 48.4065L135.166 48.5458L134.866 48.9364L134.879 49.429L134.415 49.2639L133.951 49.429L133.964 48.9364L133.664 48.5458L134.136 48.4065L134.415 48Z"
              fill="currentColor"
              fill-opacity="0.5"
            />
            <path
              d="M1.27529 29L1.50463 29.3346L1.89376 29.4493L1.64637 29.7709L1.65752 30.1764L1.27529 30.0405L0.89306 30.1764L0.904213 29.7709L0.656828 29.4493L1.04595 29.3346L1.27529 29Z"
              fill="currentColor"
              fill-opacity="0.4"
            />
            <path
              d="M61.3616 107L61.6214 107.379L62.0621 107.509L61.7819 107.873L61.7945 108.333L61.3616 108.179L60.9286 108.333L60.9413 107.873L60.6611 107.509L61.1018 107.379L61.3616 107Z"
              fill="currentColor"
              fill-opacity="0.6"
            />
            <path
              d="M144.459 61L144.753 61.4289L145.251 61.576L144.934 61.9881L144.949 62.5079L144.459 62.3337L143.969 62.5079L143.983 61.9881L143.666 61.576L144.165 61.4289L144.459 61Z"
              fill="currentColor"
              fill-opacity="0.3"
            />
            <path
              d="M36.3255 6L36.5725 6.36046L36.9917 6.48402L36.7252 6.83035L36.7372 7.26718L36.3255 7.12076L35.9137 7.26718L35.9258 6.83035L35.6593 6.48402L36.0784 6.36046L36.3255 6Z"
              fill="currentColor"
              fill-opacity="0.4"
            />
            <path
              d="M97.5475 98L97.8729 98.4747L98.4249 98.6374L98.0739 99.0936L98.0898 99.6689L97.5475 99.476L97.0053 99.6689L97.0211 99.0936L96.6702 98.6374L97.2222 98.4747L97.5475 98Z"
              fill="currentColor"
              fill-opacity="0.5"
            />
            <path
              d="M152.437 81L152.723 81.4177L153.209 81.5609L152.9 81.9622L152.914 82.4684L152.437 82.2988L151.96 82.4684L151.974 81.9622L151.665 81.5609L152.15 81.4177L152.437 81Z"
              fill="currentColor"
              fill-opacity="0.4"
            />
            <path
              d="M114.176 2L114.37 2.28354L114.7 2.38074L114.49 2.65317L114.5 2.99678L114.176 2.88161L113.852 2.99678L113.862 2.65317L113.652 2.38074L113.982 2.28354L114.176 2Z"
              fill="currentColor"
              fill-opacity="0.3"
            />
            <path
              d="M21.4439 45L21.7326 45.4214L22.2226 45.5658L21.9111 45.9707L21.9252 46.4813L21.4439 46.3102L20.9625 46.4813L20.9766 45.9707L20.6651 45.5658L21.1551 45.4214L21.4439 45Z"
              fill="currentColor"
              fill-opacity="0.6"
            />
            <path
              d="M3.29337 56L3.52908 56.3439L3.92902 56.4618L3.67476 56.7923L3.68622 57.2091L3.29337 57.0694L2.90051 57.2091L2.91197 56.7923L2.65771 56.4618L3.05765 56.3439L3.29337 56Z"
              fill="currentColor"
              fill-opacity="0.4"
            />
            <path
              d="M148.289 21L148.523 21.3415L148.92 21.4586L148.667 21.7867L148.679 22.2005L148.289 22.0618L147.899 22.2005L147.91 21.7867L147.657 21.4586L148.055 21.3415L148.289 21Z"
              fill="currentColor"
              fill-opacity="0.6"
            />
            <path
              d="M128.593 7L128.934 7.49805L129.513 7.66878L129.145 8.14731L129.162 8.75088L128.593 8.54858L128.024 8.75088L128.041 8.14731L127.672 7.66878L128.252 7.49805L128.593 7Z"
              fill="currentColor"
              fill-opacity="0.4"
            />
            <path
              d="M75.2941 27L75.5301 27.3443L75.9305 27.4624L75.676 27.7932L75.6875 28.2105L75.2941 28.0706L74.9008 28.2105L74.9123 27.7932L74.6578 27.4624L75.0582 27.3443L75.2941 27Z"
              fill="currentColor"
              fill-opacity="0.5"
            />
            <path
              d="M30.5281 65L30.8466 65.4647L31.387 65.624L31.0434 66.0705L31.0589 66.6337L30.5281 66.445L29.9973 66.6337L30.0128 66.0705L29.6692 65.624L30.2096 65.4647L30.5281 65Z"
              fill="currentColor"
              fill-opacity="0.6"
            />
            <path
              d="M43.1377 106L43.3186 106.264L43.6254 106.354L43.4303 106.608L43.4391 106.928L43.1377 106.82L42.8364 106.928L42.8451 106.608L42.6501 106.354L42.9569 106.264L43.1377 106Z"
              fill="currentColor"
              fill-opacity="0.3"
            />
            <path
              d="M85.5896 59L85.9298 59.4964L86.507 59.6665L86.1401 60.1435L86.1566 60.745L85.5896 60.5434L85.0226 60.745L85.0392 60.1435L84.6722 59.6665L85.2494 59.4964L85.5896 59Z"
              fill="currentColor"
              fill-opacity="0.4"
            />
            <path
              d="M55.5021 110L55.8114 110.451L56.3362 110.606L56.0026 111.04L56.0176 111.587L55.5021 111.403L54.9865 111.587L55.0016 111.04L54.6679 110.606L55.1928 110.451L55.5021 110Z"
              fill="currentColor"
              fill-opacity="0.5"
            />
            <path
              d="M120.365 78L120.627 78.381L121.07 78.5116L120.788 78.8777L120.801 79.3395L120.365 79.1847L119.93 79.3395L119.943 78.8777L119.661 78.5116L120.104 78.381L120.365 78Z"
              fill="currentColor"
              fill-opacity="0.6"
            />
            <path
              d="M120.171 53L120.364 53.2811L120.691 53.3774L120.483 53.6474L120.492 53.988L120.171 53.8739L119.85 53.988L119.86 53.6474L119.652 53.3774L119.979 53.2811L120.171 53Z"
              fill="currentColor"
              fill-opacity="0.6"
            />
            <path
              d="M48.3321 8L48.5815 8.36387L49.0046 8.4886L48.7356 8.83821L48.7477 9.27917L48.3321 9.13137L47.9165 9.27917L47.9286 8.83821L47.6596 8.4886L48.0827 8.36387L48.3321 8Z"
              fill="currentColor"
              fill-opacity="0.4"
            />
            <path
              d="M170.44 13L170.727 13.4194L171.215 13.5631L170.905 13.966L170.919 14.4742L170.44 14.3039L169.961 14.4742L169.975 13.966L169.665 13.5631L170.153 13.4194L170.44 13Z"
              fill="currentColor"
              fill-opacity="0.5"
            />
            <path
              d="M3.42133 3L3.70218 3.40979L4.17869 3.55025L3.87575 3.94398L3.88941 4.44058L3.42133 4.27413L2.95326 4.44058L2.96692 3.94398L2.66398 3.55025L3.14049 3.40979L3.42133 3Z"
              fill="currentColor"
              fill-opacity="0.4"
            />
          </g>
          <defs>
            <clipPath id="clip0_354_8">
              <rect
                width="171"
                height="112"
                fill="currentColor"
                transform="translate(0.625)"
              />
            </clipPath>
          </defs>
        </svg>
      </div>
    </div>
  );
}
