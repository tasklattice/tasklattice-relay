import type { ZodType } from "zod";

export const httpMethods = ["get", "post", "put", "patch", "delete"] as const;

export type HttpMethod = (typeof httpMethods)[number];

export interface ContractResponse {
  contentType?: string;
  description: string;
  schema?: ZodType;
}

export interface RouteContract {
  auth?: "expert-agent-runtime" | "public" | "runtime-bridge" | "session";
  description: string;
  method: HttpMethod;
  operationId: string;
  path: string;
  request?: {
    body?: ZodType;
    contentType?: string;
    params?: ZodType;
    query?: ZodType;
  };
  responses: Record<number, ContractResponse>;
  summary: string;
  tags: readonly string[];
}

export function defineContract<const T extends RouteContract>(contract: T): T {
  return contract;
}

export function defineContracts<const T extends readonly RouteContract[]>(
  contracts: T,
): T {
  return contracts;
}
