import { NormalGroups } from "@/components/groups/NormalGroups";
export default async function Page({params}:{params:Promise<{id:string}>}){return <NormalGroups id={(await params).id}/>;}
