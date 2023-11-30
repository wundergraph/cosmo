import { UserContext } from "@/components/app-provider"
import { useContext } from "react"

export const useUser = () => {
    return useContext(UserContext)
}