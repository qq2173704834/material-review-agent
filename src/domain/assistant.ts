import type { ModelCall } from "./model-call";
export interface AssistantCitation {
  id: string;
  version: number;
  title: string;
  url: string;
  quote: string;
  checkedAt: string;
  scope: string;
}
export interface AssistantAnswer {
  answer: string;
  kind: "考试信息" | "学习建议" | "需补充信息";
  mode: "mock" | "live" | "retrieval";
  citations: AssistantCitation[];
  conversationId: string | null;
  warning: string;
  usage?: { modelCall: ModelCall | null; cost: null };
}
