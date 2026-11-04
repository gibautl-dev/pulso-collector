"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFixtureMode } from "@/lib/mode";

export async function signOut() {
  if (!isFixtureMode()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
