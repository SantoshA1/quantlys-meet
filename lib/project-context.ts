import { projectPath, type ProjectContext } from "@/lib/prd";

/** Shared with /api/prd and /api/agent/question — one reader, so the three of
 *  them can never disagree about what a project's context is. */
export async function readContext(sb: any, userId: string, project: string): Promise<ProjectContext> {
  try {
    const { data } = await sb.storage.from("recordings").download(projectPath(userId, project));
    if (!data) return { brief: "", decisions: [] };
    const j: any = JSON.parse(await data.text());
    return {
      brief: String(j?.brief || ""),
      decisions: Array.isArray(j?.decisions) ? j.decisions : [],
    };
  } catch {
    // No file is the normal state of a new project, not an error.
    return { brief: "", decisions: [] };
  }
}
