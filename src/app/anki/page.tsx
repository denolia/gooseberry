import { redirect } from "next/navigation";

export default function AnkiPage() {
  redirect("/?tab=anki");
}
