export interface MissionInput {
  missionId: string;
  inputText: string;
  requestedOutput?: string;
  sensitivity?: "low" | "medium" | "high" | "critical";
}
