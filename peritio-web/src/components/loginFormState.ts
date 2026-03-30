import { WebAuthRequestCodeResponse } from "@voicepractice/shared";

export interface LoginFormRequestCodeSuccessState {
  step: "verify_code";
  notice: string;
}

export function resolveLoginFormRequestCodeSuccess(
  response: WebAuthRequestCodeResponse
): LoginFormRequestCodeSuccessState {
  return {
    step: "verify_code",
    notice: response.message,
  };
}
