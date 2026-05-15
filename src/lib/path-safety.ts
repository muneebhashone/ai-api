import { relative, resolve, sep } from "node:path";

export function isWithinDirectory(root: string, candidate: string): boolean {
  const safeRoot = resolve(root);
  const safeCandidate = resolve(candidate);
  const rel = relative(safeRoot, safeCandidate);
  return rel === "" || (!!rel && !rel.startsWith("..") && !rel.includes(`..${sep}`) && !rel.startsWith("..\\") && !rel.startsWith("../"));
}
