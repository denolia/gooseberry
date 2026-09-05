"use client";

import { Activity } from "react";
import { usePathname } from "next/navigation";
import { WordInputWithAuth } from "@/components/ui/WordInputWithAuth";
import { WordSetList } from "@/components/anki/WordSetList";
import { TextAnalyzer } from "@/components/analyzer/TextAnalyzer";

export function LandingPanels() {
  const pathname = usePathname();
  const activePath =
    pathname === "/anki"
      ? "/anki"
      : pathname === "/analyzer"
        ? "/analyzer"
        : "/";

  return (
    <>
      <Activity mode={activePath === "/" ? "visible" : "hidden"}>
        <div hidden={activePath !== "/"}>
          <WordInputWithAuth />
        </div>
      </Activity>
      <Activity mode={activePath === "/analyzer" ? "visible" : "hidden"}>
        <div hidden={activePath !== "/analyzer"}>
          <TextAnalyzer />
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
