import Link from "next/link";

interface AccountLinkProps {
  title: string;
  subtitle: string;
  href: string;
  linkText: string;
}

export default function AccountLink({ title, subtitle, href, linkText }: AccountLinkProps) {
  return (
    <>
      <h2 className="mb-1 text-2xl font-medium">{ title }</h2>
      <div className="w-full">
        <p className="text-muted-foreground">
          { subtitle }{" "}
          <Link
            href={ href }
            className="underline hover:text-foreground"
          >
            { linkText }
          </Link>
        </p> 
      </div>
    </>
  )
}
