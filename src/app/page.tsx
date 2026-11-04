import { allProjects } from "@/lib/db";
import Workspace from "@/components/Workspace";
export const dynamic="force-dynamic";
export default function Home(){return <Workspace initialProjects={JSON.parse(JSON.stringify(allProjects()))}/>}
