"use client";
import {useEffect} from "react";
import {activateGroupPresence} from "@giggle/core";
/** A call page owns presence; a detached Games bridge never owns it. */
export function useGroupPresence(squadId:string,enabled=true) {
  useEffect(()=>enabled && squadId ? activateGroupPresence(squadId) : undefined,[squadId,enabled]);
}
