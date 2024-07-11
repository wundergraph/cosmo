import { FullscreenLayout } from "@/components/layout/fullscreen-layout"
import { Loader } from "@/components/ui/loader"
import { useUser } from "@/hooks/use-user"
import { NextPageWithLayout } from "@/lib/page"
import { useRouter } from "next/router"
import { useEffect } from "react"

const NewGraphPage: NextPageWithLayout = () => {
    const user = useUser()
    const router = useRouter()

    useEffect(() => {
        if(!user) return

        router.push(`/${user.currentOrganization.slug}/new`)
    }, [user, router])

    return <div className="h-screen"><Loader fullscreen /></div>
}

NewGraphPage.getLayout = (page) => {
  return <FullscreenLayout>{page}</FullscreenLayout>;
};


export default NewGraphPage