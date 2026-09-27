import { createHash } from "node:crypto";

/** Vtiger login accessKey = md5(challengeToken + userAccessKey). */
export function vtigerLoginAccessKey(challengeToken: string, userAccessKey: string): string {
  return createHash("md5").update(`${challengeToken}${userAccessKey}`, "utf8").digest("hex");
}
