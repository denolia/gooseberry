"use client";

import { Activity } from "react";
import { usePathname } from "next/navigation";
import { WordInputWithAuth } from "@/components/ui/WordInputWithAuth";
import { WordSetList } from "@/components/anki/WordSetList";

export function LandingPanels() {
  const pathname = usePathname();
  const activePath = pathname === "/anki" ? "/anki" : "/";

  return (
    <>
      <Activity mode={activePath === "/" ? "visible" : "hidden"}>
        <div hidden={activePath !== "/"}>
          <WordInputWithAuth />
        </div>
      </Activity>
      <Activity mode={activePath === "/anki" ? "visible" : "hidden"}>
        <div hidden={activePath !== "/anki"}>
          <WordSetList />
        </div>
      </Activity>
    </>
  );
}
